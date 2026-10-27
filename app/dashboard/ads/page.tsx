import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace, canManage } from "@/lib/workspace";
import { supabaseAdmin, publicAssetUrl } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";
import { launchClickToChatAd, AdStepError, type AdDestination, type AdTargeting } from "@/lib/meta";
import { setDelivery, updateAdSet, updateAdText, validateAdEdit, MetaApiError } from "@/lib/ads";
import { syncWorkspaceAds } from "@/lib/ads-sync";
import { adFunnel } from "@/lib/funnel";
import { AD_STEPS, explainAdError, parseStoredFailure, type AdFailure } from "@/lib/ad-errors";
import AdBuilder from "./AdBuilder";

export const metadata = { title: "Ads" };

const DEST_LABEL: Record<AdDestination, string> = { whatsapp: "WhatsApp chat", messenger: "Messenger chat", instagram: "Instagram DM" };

const AUDIENCE_TARGETING: Record<string, AdTargeting> = {
  everyone: { countries: ["NG"] },
  ng_18_34: { countries: ["NG"], ageMin: 18, ageMax: 34 },
  ng_25_45: { countries: ["NG"], ageMin: 25, ageMax: 45 },
  ng_women: { countries: ["NG"], ageMin: 18, ageMax: 45, genders: [2] },
  ng_men: { countries: ["NG"], ageMin: 18, ageMax: 45, genders: [1] },
};

async function launchAd(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/ads?error=role");
  const db = supabaseAdmin();

  const adAccountId = String(formData.get("ad_account_id") ?? "");
  const pageId = String(formData.get("page_id") ?? "");
  const itemId = String(formData.get("item_id") ?? "");
  const destination = String(formData.get("destination") ?? "whatsapp") as AdDestination;
  const audience = String(formData.get("audience") ?? "everyone");
  const budget = Math.round(Number(formData.get("budget") ?? 0));
  const message = String(formData.get("message") ?? "").trim().slice(0, 600);
  const headlineIn = String(formData.get("headline") ?? "").trim().slice(0, 40);
  const endDate = String(formData.get("end_date") ?? "").trim();
  if (!adAccountId || !pageId || !itemId || !message || !(budget > 0)) redirect("/dashboard/ads?error=missing");

  const [{ data: adConn }, { data: item }] = await Promise.all([
    db.from("ad_connections").select("ad_account_id,access_token_enc").eq("workspace_id", ctx.workspace.id).eq("ad_account_id", adAccountId).maybeSingle(),
    db.from("catalogue_items").select("name,image_path").eq("workspace_id", ctx.workspace.id).eq("id", itemId).maybeSingle(),
  ]);
  if (!adConn) redirect("/dashboard/ads?error=noads");

  const { data: acctRow } = await db.from("ad_connections").select("currency").eq("workspace_id", ctx.workspace.id).eq("ad_account_id", adAccountId).maybeSingle();
  const endTime = endDate ? new Date(`${endDate}T23:59:00+01:00`).toISOString() : null;
  const problem = validateAdEdit({ dailyBudgetMinor: budget * 100, currency: acctRow?.currency ?? "NGN", endTime, message, headline: headlineIn || undefined });
  if (problem) redirect(`/dashboard/ads?error=invalid&why=${encodeURIComponent(problem)}`);

  const name = `Dall AI · ${item?.name ?? "Boost"} · ${new Date().toISOString().slice(0, 10)}`;
  // An uploaded photo wins over the catalogue photo.
  let imageUrl = item?.image_path ? publicAssetUrl(item.image_path) : null;
  const upload = formData.get("media");
  if (upload instanceof File && upload.size > 0) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(upload.type) || upload.size > 4 * 1024 * 1024) redirect("/dashboard/ads?error=media");
    const path = `${ctx.workspace.id}/ads/${Date.now()}.${upload.type.split("/")[1]}`;
    const { error: upErr } = await db.storage.from("brand-assets").upload(path, Buffer.from(await upload.arrayBuffer()), { contentType: upload.type });
    if (upErr) redirect("/dashboard/ads?error=media");
    imageUrl = publicAssetUrl(path);
  }
  const ageMin = Number(formData.get("age_min") || 0), ageMax = Number(formData.get("age_max") || 0);
  const baseTargeting = AUDIENCE_TARGETING[audience] ?? AUDIENCE_TARGETING.everyone;
  const targeting: AdTargeting = audience === "custom"
    ? { countries: ["NG"], ageMin: Math.max(18, Math.min(65, ageMin || 18)), ageMax: Math.max(18, Math.min(65, ageMax || 65)), genders: formData.get("gender") === "1" ? [1] : formData.get("gender") === "2" ? [2] : undefined }
    : baseTargeting;

  let ids;
  try {
    ids = await launchClickToChatAd({
      adAccountId, token: decryptSecret(adConn.access_token_enc), pageId,
      destination, name, headline: headlineIn || item?.name || "Order now", message, dailyBudgetMinor: budget * 100, imageUrl,
      targeting, endTime,
    });
  } catch (e) {
    const failure: AdFailure = e instanceof AdStepError ? e.failure : explainAdError("campaign", (e as Error).message);
    console.error("[ads] launch failed", failure.step, failure.code, failure.subcode, failure.title);
    await db.from("ad_campaigns").insert({
      workspace_id: ctx.workspace.id, ad_account_id: adAccountId, product_label: item?.name ?? null,
      destination, message, daily_budget_minor: budget * 100, status: "failed", last_error: JSON.stringify(failure), created_by: ctx.user.id,
    });
    redirect("/dashboard/ads?error=launch");
  }

  await db.from("ad_campaigns").insert({
    workspace_id: ctx.workspace.id, ad_account_id: adAccountId, product_label: item?.name ?? null,
    destination, message, daily_budget_minor: budget * 100,
    meta_campaign_id: ids.campaignId, meta_adset_id: ids.adsetId, meta_creative_id: ids.creativeId, meta_ad_id: ids.adId,
    status: "draft", meta_status: "PAUSED", name, page_id: pageId, created_by: ctx.user.id,
  });
  await db.from("financial_audit_logs").insert({ workspace_id: ctx.workspace.id, actor_id: ctx.user.id, action: "ads.campaign_created", entity: "ad_campaign", entity_id: ids.campaignId, details: { destination, budget_minor: budget * 100, product: item?.name, audience } });
  revalidatePath("/dashboard/ads");
  redirect("/dashboard/ads?saved=launched");
}

async function clearFailed() {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/ads?error=role");
  await supabaseAdmin().from("ad_campaigns").delete().eq("workspace_id", ctx.workspace.id).eq("status", "failed");
  revalidatePath("/dashboard/ads");
  redirect("/dashboard/ads");
}

/** Loads a campaign of this business plus a usable token, or bounces back with an error. */
async function ownCampaign(formData: FormData) {
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/ads?error=role");
  const db = supabaseAdmin();
  const { data: c } = await db.from("ad_campaigns").select("*").eq("id", String(formData.get("id") ?? "")).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!c?.meta_campaign_id) redirect("/dashboard/ads?error=nocampaign");
  const { data: conn } = await db.from("ad_connections").select("access_token_enc,currency,status").eq("workspace_id", ctx.workspace.id).eq("ad_account_id", c.ad_account_id).maybeSingle();
  if (!conn) redirect("/dashboard/ads?error=noads");
  return { ctx, db, c, token: decryptSecret(conn.access_token_enc), currency: conn.currency ?? "NGN" };
}

async function metaFailed(ctx: { workspace: { id: string } }, what: string, e: unknown): Promise<never> {
  const msg = e instanceof MetaApiError ? e.message : (e as Error).message;
  await supabaseAdmin().from("integration_errors").insert({ workspace_id: ctx.workspace.id, source: "ads_update", message: `${what}: ${msg}`.slice(0, 1000) });
  redirect(`/dashboard/ads?error=meta&why=${encodeURIComponent(`${what}: ${msg}`.slice(0, 220))}`);
}

async function changeDelivery(formData: FormData) {
  "use server";
  const { ctx, db, c, token } = await ownCampaign(formData);
  const to = formData.get("to") === "ACTIVE" ? "ACTIVE" : "PAUSED";
  // Spending money needs an explicit yes from the owner on this exact campaign.
  if (to === "ACTIVE" && formData.get("confirm_spend") !== "yes") redirect("/dashboard/ads?error=confirm");
  try { await setDelivery(token, { campaignId: c.meta_campaign_id!, adsetId: c.meta_adset_id, adId: c.meta_ad_id }, to); }
  catch (e) { await metaFailed(ctx, to === "ACTIVE" ? "Couldn't switch the campaign on" : "Couldn't pause the campaign", e); }
  await db.from("ad_campaigns").update({ status: to === "ACTIVE" ? "active" : "paused", meta_status: to }).eq("id", c.id);
  await db.from("financial_audit_logs").insert({ workspace_id: ctx.workspace.id, actor_id: ctx.user.id, action: to === "ACTIVE" ? "ads.campaign_activated" : "ads.campaign_paused", entity: "ad_campaign", entity_id: c.meta_campaign_id, details: { daily_budget_minor: c.daily_budget_minor } });
  revalidatePath("/dashboard/ads");
  redirect(`/dashboard/ads?saved=${to === "ACTIVE" ? "activated" : "paused"}`);
}

async function editCampaign(formData: FormData) {
  "use server";
  const { ctx, db, c, token, currency } = await ownCampaign(formData);
  const budgetIn = String(formData.get("budget") ?? "").trim();
  const endIn = String(formData.get("end_date") ?? "").trim();
  const clearEnd = formData.get("clear_end") === "on";
  const message = String(formData.get("message") ?? "").trim();
  const headline = String(formData.get("headline") ?? "").trim();
  const dailyBudgetMinor = budgetIn ? Math.round(Number(budgetIn) * 100) : undefined;
  const endTime = clearEnd ? null : endIn ? new Date(`${endIn}T23:59:00+01:00`).toISOString() : undefined;
  const problem = validateAdEdit({ dailyBudgetMinor, currency, endTime, message: message || undefined, headline: headline || undefined });
  if (problem) redirect(`/dashboard/ads?error=invalid&why=${encodeURIComponent(problem)}`);
  try {
    if (c.meta_adset_id && (dailyBudgetMinor !== undefined || endTime !== undefined)) await updateAdSet(token, c.meta_adset_id, { dailyBudgetMinor, endTime });
    if (c.meta_ad_id && (message || headline)) await updateAdText(token, c.ad_account_id, c.meta_ad_id, { message: message || undefined, headline: headline || undefined });
  } catch (e) { await metaFailed(ctx, "Couldn't update the campaign", e); }
  await db.from("ad_campaigns").update({ ...(dailyBudgetMinor ? { daily_budget_minor: dailyBudgetMinor } : {}), ...(message ? { message } : {}) }).eq("id", c.id);
  await db.from("financial_audit_logs").insert({ workspace_id: ctx.workspace.id, actor_id: ctx.user.id, action: "ads.campaign_edited", entity: "ad_campaign", entity_id: c.meta_campaign_id, details: { daily_budget_minor: dailyBudgetMinor ?? null, end_time: endTime ?? null, text_changed: Boolean(message || headline) } });
  revalidatePath("/dashboard/ads");
  redirect("/dashboard/ads?saved=edited");
}

async function syncNow() {
  "use server";
  const ctx = await requireWorkspace();
  const r = await syncWorkspaceAds(ctx.workspace.id, 90);
  revalidatePath("/dashboard/ads");
  redirect(`/dashboard/ads?saved=synced&n=${r.synced}&f=${r.failed}`);
}

function StepTrack({ failedAt }: { failedAt: string }) {
  const idx = AD_STEPS.findIndex((x) => x.step === failedAt);
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0" }}>
      {AD_STEPS.map((x, i) => {
        const st = i < idx ? "done" : i === idx ? "fail" : "todo";
        const c = { done: ["#E3F5EA", "#1E7A45", "✓"], fail: ["#FBE4E1", "#A52A1E", "✕"], todo: ["#F1F2F0", "#9AA19F", String(i + 1)] }[st];
        return <span key={x.step} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: c[0], color: c[1], borderRadius: 999, padding: "4px 10px 4px 4px", fontSize: 12, fontWeight: 600 }}>
          <span style={{ width: 18, height: 18, borderRadius: 99, background: "#fff", display: "grid", placeItems: "center", fontSize: 11 }}>{c[2]}</span>{x.label}</span>;
      })}
    </div>
  );
}

const RANGES: Record<string, { label: string; days: number | null }> = { "7": { label: "Last 7 days", days: 7 }, "30": { label: "Last 30 days", days: 30 }, "90": { label: "Last 90 days", days: 90 }, all: { label: "Lifetime", days: null } };

export default async function AdsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireWorkspace();
  const sp = await searchParams;
  const db = supabaseAdmin();
  const [{ data: adConns }, { data: pages }, { data: items }, { data: campaigns }] = await Promise.all([
    db.from("ad_connections").select("ad_account_id,name,currency,access_token_enc,status").eq("workspace_id", ctx.workspace.id).order("created_at"),
    db.from("channel_connections").select("external_id,display_name").eq("workspace_id", ctx.workspace.id).eq("provider", "facebook").eq("status", "active"),
    db.from("catalogue_items").select("id,name,image_path").eq("workspace_id", ctx.workspace.id).eq("active", true).order("name"),
    db.from("ad_campaigns").select("id,name,product_label,destination,daily_budget_minor,status,meta_status,effective_status,last_synced_at,last_error,meta_campaign_id,meta_ad_id,ad_account_id,message,created_at").eq("workspace_id", ctx.workspace.id).order("created_at", { ascending: false }).limit(50),
  ]);
  const range = RANGES[sp.range ?? "30"] ? (sp.range ?? "30") : "30";
  const sinceDay = RANGES[range].days ? new Date(Date.now() - RANGES[range].days! * 86400_000).toISOString().slice(0, 10) : "2000-01-01";
  const iq = db.from("ad_insights_daily").select("ad_campaign_id,day,spend_minor,impressions,reach,clicks,conversations_started,leads").eq("workspace_id", ctx.workspace.id).gte("day", sinceDay);
  const { data: insightRows } = await iq;
  const funnel = await adFunnel(ctx.workspace.id, RANGES[range].days ?? 3650);
  const needsReconnect = (adConns ?? []).filter((a) => a.status === "needs_reconnect");

  const accounts = [...(adConns ?? [])].filter((a) => a.status === "active").sort((a, b) => Number(b.currency === "NGN") - Number(a.currency === "NGN"));
  const curOf = new Map(accounts.map((a) => [a.ad_account_id, a.currency ?? "NGN"]));
  const failedCount = (campaigns ?? []).filter((c) => c.status === "failed").length;
  const firstFailedId = (campaigns ?? []).find((c) => c.status === "failed")?.id;

  // Reporting comes from synced insights (Sync now, or the daily job), filtered by range/account/status.
  const visible = (campaigns ?? []).filter((c) => (!sp.acct || c.ad_account_id === sp.acct) && (!sp.st || c.status === sp.st));
  const sumFor = (ids: Set<string>) => (insightRows ?? []).filter((r) => ids.has(r.ad_campaign_id)).reduce((t, r) => ({
    spend: t.spend + Number(r.spend_minor), impressions: t.impressions + Number(r.impressions), reach: t.reach + Number(r.reach),
    clicks: t.clicks + Number(r.clicks), conversations: t.conversations + Number(r.conversations_started), leads: t.leads + Number(r.leads), days: t.days + 1,
  }), { spend: 0, impressions: 0, reach: 0, clicks: 0, conversations: 0, leads: 0, days: 0 });
  const stats = new Map(visible.map((c) => [c.id, sumFor(new Set([c.id]))]));
  const totals = sumFor(new Set(visible.map((c) => c.id)));
  const lastSync = (campaigns ?? []).map((c) => c.last_synced_at).filter(Boolean).sort().pop();
  const fmt = (n: number) => n.toLocaleString("en-NG");

  const errors: Record<string, string> = {
    role: "Only owners and admins can run ads.",
    missing: "Pick a product, write the ad text, choose a Page, and set a daily budget above zero.",
    noads: "That ad account isn't connected. Reconnect on the Channels page.",
    launch: "The campaign wasn't created. The first card under Your campaigns shows which step failed and what to do.",
    confirm: "To switch a campaign on, tick the box confirming it will start spending your budget.",
    meta: "Meta didn't accept the change",
    invalid: "Check the campaign settings",
    media: "Upload a JPG, PNG or WEBP photo under 4 MB.",
    nocampaign: "That campaign isn't on Meta yet.",
  };
  const saved: Record<string, string> = {
    launched: "Campaign created as a draft (paused). Review it below and switch it on when you're ready; nothing spends until then.",
    activated: "Campaign switched on. Meta will review the ad (usually within a few hours) and then start spending your daily budget.",
    paused: "Campaign paused. It stops spending right away.",
    edited: "Campaign updated on Meta.",
    synced: `Synced from Meta: ${sp.n ?? 0} campaign(s) updated${sp.f && sp.f !== "0" ? `, ${sp.f} failed (see Channels → integration errors)` : ""}.`,
  };

  const itemsForBuilder = (items ?? []).map((i) => ({ id: i.id, name: i.name, imageUrl: i.image_path ? publicAssetUrl(i.image_path) : null }));

  return (
    <>
      <div className="page-head"><div><h1>Ads</h1><p>Turn a product into a Facebook or Instagram ad that drops people straight into a chat with your assistant — which then quotes, takes the order, and collects payment. Campaigns are created paused; nothing spends until you switch them on.</p></div></div>
      {sp.saved && saved[sp.saved] && <div className="notice notice-ok" role="status">{saved[sp.saved]}</div>}
      {sp.error && <div className="notice notice-bad" role="alert">{errors[sp.error] ?? "Something went wrong."}{sp.why ? `: ${sp.why}` : ""}</div>}
      {needsReconnect.length > 0 && <div className="notice notice-bad" role="alert">Meta access expired for {needsReconnect.map((a) => a.name ?? a.ad_account_id).join(", ")}. <a href="/api/meta/facebook/start">Reconnect via Meta</a> to keep managing and reporting on these campaigns.</div>}

      {accounts.length === 0 ? (
        <section className="panel"><h2>Connect an ad account</h2><p style={{ color: "var(--ink-70)" }}>You haven't connected a Meta ad account yet. Go to <a href="/dashboard/connect">Channels</a>, log in with Facebook, and grant ads access.</p></section>
      ) : (items ?? []).length === 0 ? (
        <section className="panel"><h2>Add a product first</h2><p style={{ color: "var(--ink-70)" }}>Ads promote a product from your <a href="/dashboard/catalogue">Catalogue</a>. Add one, then come back.</p></section>
      ) : (
        <section className="panel">
          <h2>Boost a product</h2>
          <AdBuilder accounts={accounts.map((a) => ({ ad_account_id: a.ad_account_id, name: a.name, currency: a.currency }))} pages={(pages ?? []).map((p) => ({ external_id: p.external_id, display_name: p.display_name }))} items={itemsForBuilder} action={launchAd} />
        </section>
      )}

      {(campaigns ?? []).some((c) => c.meta_campaign_id) && (
        <section className="panel" style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <h2 style={{ margin: 0 }}>Results</h2>
            <form action={syncNow} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <small style={{ color: "var(--ink-70)" }}>{lastSync ? `Last synced ${new Date(lastSync).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" })}` : "Not synced yet"}</small>
              <button className="btn btn-line btn-sm">↻ Sync now</button>
            </form>
          </div>
          <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0" }}>
            <select name="range" defaultValue={range} className="input" style={{ width: "auto" }}>{Object.entries(RANGES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
            <select name="acct" defaultValue={sp.acct ?? ""} className="input" style={{ width: "auto" }}><option value="">All ad accounts</option>{(adConns ?? []).map((a) => <option key={a.ad_account_id} value={a.ad_account_id}>{a.name ?? a.ad_account_id} ({a.currency})</option>)}</select>
            <select name="st" defaultValue={sp.st ?? ""} className="input" style={{ width: "auto" }}><option value="">Any status</option><option value="active">Active</option><option value="paused">Paused</option><option value="draft">Draft</option><option value="failed">Failed</option></select>
            <button className="btn btn-ink btn-sm">Apply</button>
          </form>
          <div className="stats">
            <div className="stat"><span>Spend</span><b>{(sp.acct ? curOf.get(sp.acct) : accounts[0]?.currency) === "USD" ? "$" : "₦"}{fmt(totals.spend / 100)}</b></div>
            <div className="stat"><span>Reach</span><b>{fmt(totals.reach)}</b></div>
            <div className="stat"><span>Impressions</span><b>{fmt(totals.impressions)}</b></div>
            <div className="stat"><span>Clicks</span><b>{fmt(totals.clicks)}</b></div>
            <div className="stat"><span>Chats started (Meta)</span><b>{fmt(totals.conversations)}</b></div>
            <div className="stat"><span>Leads (Meta)</span><b>{fmt(totals.leads)}</b></div>
          </div>
          {totals.days === 0 && <p style={{ fontSize: 13, color: "var(--ink-70)" }}>No delivery data for this range yet. Draft and paused campaigns don&apos;t spend, so they have no results.</p>}
          {accounts.length > 1 && !sp.acct && <p style={{ fontSize: 12, color: "var(--ink-70)" }}>Spend is added across accounts; filter by one account to see it in its own currency.</p>}
          <h3 style={{ fontSize: 15, marginTop: 14 }}>From ad to sale</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>Campaign</th><th className="num">Spend</th><th className="num">Chats (Meta)</th><th className="num">Chats we received</th><th className="num">Leads saved</th><th className="num">Paid orders</th></tr></thead>
            <tbody>{funnel.rows.map((r) => <tr key={r.id}><td>{r.name}</td><td className="num">{r.spend}</td><td className="num">{r.metaConversations ?? "—"}</td><td className="num">{r.conversations}</td><td className="num">{r.leads}</td><td className="num">{r.paidOrders}</td></tr>)}</tbody>
          </table></div>
          <p style={{ fontSize: 12, color: "var(--ink-70)" }}>A chat counts for a campaign only when Meta sent that ad&apos;s ID with the first message. {funnel.unattributed} chat(s) in this period had no ad information.</p>
        </section>
      )}

      {accounts.length > 0 && (
        <section className="panel" style={{ marginTop: 16 }}>
          <h2>Your campaigns</h2>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: -6, marginBottom: 10 }}>
            <span style={{ color: "var(--ink-70)", fontSize: 13 }}>{visible.length} shown{failedCount ? ` · ${failedCount} failed` : ""}</span>
            {failedCount > 0 && <form action={clearFailed}><button className="btn btn-ghost btn-sm">Clear failed attempts</button></form>}
          </div>
          {visible.length === 0
            ? <p style={{ color: "var(--ink-70)" }}>No campaigns {sp.st || sp.acct ? "match these filters" : "yet. Create your first one above"}.</p>
            : <div style={{ display: "grid", gap: 10 }}>
                {visible.map((c) => {
                  const st = stats.get(c.id);
                  const cur = curOf.get(c.ad_account_id) ?? "NGN";
                  const f = c.status === "failed" ? parseStoredFailure(c.last_error) : null;
                  const when = new Date(c.created_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });
                  const badge = c.status === "failed" ? ["Failed", "#FBE4E1", "#A52A1E"] : c.status === "draft" ? ["Draft · paused", "#EEF0EE", "#5B6461"]
                    : c.status === "paused" ? ["Paused", "#FBF0DC", "#8A5A0B"] : c.status === "active" ? [`Active${c.effective_status && c.effective_status !== "ACTIVE" ? ` · ${c.effective_status.replace(/_/g, " ").toLowerCase()}` : ""}`, "#E3F5EA", "#1E7A45"] : [c.status, "#EEF0EE", "#5B6461"];
                  const head = (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{c.product_label ?? c.name ?? "Boost"}</div>
                        <div style={{ fontSize: 13, color: "var(--ink-70)" }}>{DEST_LABEL[c.destination as AdDestination] ?? c.destination} · {cur} {(c.daily_budget_minor / 100).toLocaleString()}/day · {when}</div>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 6, background: badge[1], color: badge[2] }}>{badge[0]}</span>
                    </div>
                  );
                  if (f) {
                    const open = c.id === firstFailedId;
                    return (
                      <details key={c.id} open={open} style={{ border: "1px solid #F1C7C0", background: "#FFFBFA", borderRadius: 12, padding: 14 }}>
                        <summary style={{ listStyle: "none", cursor: "pointer" }}>{head}
                          {!open && <div style={{ fontSize: 13, color: "#A52A1E", marginTop: 6 }}>Stopped at “{AD_STEPS.find((x) => x.step === f.step)?.label}”: {f.title}</div>}
                        </summary>
                        <StepTrack failedAt={f.step} />
                        <div style={{ fontWeight: 700, color: "#7A2017" }}>{f.title}</div>
                        <p style={{ fontSize: 13.5, margin: "4px 0 10px", color: "var(--ink-70)" }}>Meta said: “{f.message}”</p>
                        <div style={{ background: "#fff", border: "1px solid var(--line,#e7e7e3)", borderRadius: 10, padding: "10px 12px", fontSize: 13.5 }}>
                          <b>What to do:</b> {f.fix}
                          <div style={{ marginTop: 6, fontSize: 12, color: f.ourBug ? "#1F4FD1" : "#8A5A0B" }}>{f.ourBug ? "● This was a Dall AI bug — not your account." : "● This needs a change on your Meta account or in the form."}</div>
                        </div>
                        <details style={{ marginTop: 10 }}>
                          <summary style={{ fontSize: 12, color: "var(--ink-70)", cursor: "pointer" }}>Technical details{f.code ? ` (code ${f.code}${f.subcode ? ` / ${f.subcode}` : ""})` : ""}</summary>
                          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11, background: "#F6F6F3", padding: 10, borderRadius: 8, marginTop: 6 }}>{f.raw}</pre>
                        </details>
                      </details>
                    );
                  }
                  return (
                    <div key={c.id} style={{ border: "1px solid var(--line,#e7e7e3)", borderRadius: 12, padding: 14 }}>
                      {head}
                      {st && st.days > 0 ? <div style={{ fontSize: 13, marginTop: 8 }}>{RANGES[range].label}: spent <b>{cur} {fmt(st.spend / 100)}</b> · <b>{fmt(st.conversations)}</b> chats started · {fmt(st.reach)} reached · {fmt(st.clicks)} clicks</div>
                        : c.meta_campaign_id ? <div style={{ fontSize: 13, marginTop: 8, color: "var(--ink-70)" }}>No delivery in {RANGES[range].label.toLowerCase()}{c.last_synced_at ? "" : " (not synced yet)"}.</div> : null}
                      {c.meta_campaign_id && <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        {c.meta_status === "ACTIVE" ? (
                          <form action={changeDelivery}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="to" value="PAUSED" /><button className="btn btn-ink btn-sm">⏸ Pause</button></form>
                        ) : (
                          <form action={changeDelivery} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: "#F6F8EE", borderRadius: 10, padding: "6px 10px" }}>
                            <input type="hidden" name="id" value={c.id} /><input type="hidden" name="to" value="ACTIVE" />
                            <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="confirm_spend" value="yes" required /> I understand this starts spending up to <b>{cur} {fmt(c.daily_budget_minor / 100)}/day</b></label>
                            <button className="btn btn-lime btn-sm">▶ Switch on</button>
                          </form>
                        )}
                        <a className="btn btn-line btn-sm" href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${c.ad_account_id.replace("act_", "")}&selected_campaign_ids=${c.meta_campaign_id}`} target="_blank" rel="noreferrer">Ads Manager ↗</a>
                      </div>}
                      {c.meta_campaign_id && (
                        <details style={{ marginTop: 10 }}>
                          <summary style={{ fontSize: 13, cursor: "pointer" }}>✏️ Edit budget, end date or ad text</summary>
                          <form action={editCampaign} style={{ display: "grid", gap: 8, marginTop: 8, maxWidth: 520 }}>
                            <input type="hidden" name="id" value={c.id} />
                            <label className="field"><span>Daily budget ({cur})</span><input name="budget" type="number" min={1} step={1} className="input" placeholder={String(c.daily_budget_minor / 100)} /></label>
                            <label className="field"><span>End date</span><input name="end_date" type="date" className="input" /></label>
                            <label style={{ fontSize: 13, display: "flex", gap: 6 }}><input type="checkbox" name="clear_end" /> Run continuously (remove end date)</label>
                            <label className="field"><span>Headline (max 40)</span><input name="headline" maxLength={40} className="input" placeholder="Leave empty to keep" /></label>
                            <label className="field"><span>Ad text</span><textarea name="message" rows={3} maxLength={600} className="input" placeholder={c.message ?? "Leave empty to keep"} /></label>
                            <div><button className="btn btn-ink btn-sm">Save changes on Meta</button> <small style={{ color: "var(--ink-70)" }}>Text edits make Meta review the ad again.</small></div>
                          </form>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>}
        </section>
      )}

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Coming to Ads</h2>
        <p style={{ color: "var(--ink-70)", fontSize: 14, marginTop: 4 }}>What sets Dall AI apart: because it also takes the order and confirms the payment, it can show what each ad truly earns — not just clicks.</p>
        <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--ink-70)", fontSize: 14, lineHeight: 1.7 }}>
          <li><b>True Naira ROI</b> — spend vs. confirmed orders and revenue from each ad&rsquo;s chats, not just &ldquo;conversations started.&rdquo;</li>
          <li><b>Retarget past chatters</b> — re-reach people who messaged but didn&rsquo;t buy, inside the free follow-up window.</li>
          <li><b>Lookalikes of your buyers</b> — find new customers who resemble the ones who already paid.</li>
          <li><b>A/B test</b> two ad texts or photos and keep the cheaper-per-chat winner automatically.</li>
          <li><b>Auto-pause</b> an ad when cost per chat climbs past a limit you set.</li>
        </ul>
        <p style={{ color: "var(--ink-70)", fontSize: 13, marginTop: 8 }}>Tell me which of these matters most and I&rsquo;ll build it next.</p>
      </section>
    </>
  );
}
