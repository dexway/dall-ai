import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace, canManage } from "@/lib/workspace";
import { supabaseAdmin, publicAssetUrl } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";
import { launchClickToChatAd, campaignInsights, AdStepError, type AdDestination, type AdTargeting } from "@/lib/meta";
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
  if (!adAccountId || !pageId || !itemId || !message || !(budget > 0)) redirect("/dashboard/ads?error=missing");

  const [{ data: adConn }, { data: item }] = await Promise.all([
    db.from("ad_connections").select("ad_account_id,access_token_enc").eq("workspace_id", ctx.workspace.id).eq("ad_account_id", adAccountId).maybeSingle(),
    db.from("catalogue_items").select("name,image_path").eq("workspace_id", ctx.workspace.id).eq("id", itemId).maybeSingle(),
  ]);
  if (!adConn) redirect("/dashboard/ads?error=noads");

  const name = `Dall AI · ${item?.name ?? "Boost"} · ${new Date().toISOString().slice(0, 10)}`;
  const imageUrl = item?.image_path ? publicAssetUrl(item.image_path) : null;

  let ids;
  try {
    ids = await launchClickToChatAd({
      adAccountId, token: decryptSecret(adConn.access_token_enc), pageId,
      destination, name, headline: item?.name ?? "Order now", message, dailyBudgetMinor: budget * 100, imageUrl,
      targeting: AUDIENCE_TARGETING[audience] ?? AUDIENCE_TARGETING.everyone,
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
    status: "draft", created_by: ctx.user.id,
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

export default async function AdsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireWorkspace();
  const sp = await searchParams;
  const db = supabaseAdmin();
  const [{ data: adConns }, { data: pages }, { data: items }, { data: campaigns }] = await Promise.all([
    db.from("ad_connections").select("ad_account_id,name,currency,access_token_enc,status").eq("workspace_id", ctx.workspace.id).eq("status", "active").order("created_at"),
    db.from("channel_connections").select("external_id,display_name").eq("workspace_id", ctx.workspace.id).eq("provider", "facebook").eq("status", "active"),
    db.from("catalogue_items").select("id,name,image_path").eq("workspace_id", ctx.workspace.id).eq("active", true).order("name"),
    db.from("ad_campaigns").select("id,product_label,destination,daily_budget_minor,status,last_error,meta_campaign_id,ad_account_id,created_at").eq("workspace_id", ctx.workspace.id).order("created_at", { ascending: false }).limit(20),
  ]);

  const accounts = [...(adConns ?? [])].sort((a, b) => Number(b.currency === "NGN") - Number(a.currency === "NGN"));
  const curOf = new Map(accounts.map((a) => [a.ad_account_id, a.currency ?? "NGN"]));
  const failedCount = (campaigns ?? []).filter((c) => c.status === "failed").length;
  const firstFailedId = (campaigns ?? []).find((c) => c.status === "failed")?.id;

  // Best-effort live stats for campaigns that have launched on Meta.
  const tokenByAccount = new Map(accounts.map((a) => [a.ad_account_id, a.access_token_enc]));
  const statsEntries = await Promise.all((campaigns ?? []).filter((c) => c.meta_campaign_id).map(async (c) => {
    const enc = tokenByAccount.get(c.ad_account_id);
    if (!enc) return [c.id, null] as const;
    try { return [c.id, await campaignInsights(c.meta_campaign_id!, decryptSecret(enc))] as const; }
    catch { return [c.id, null] as const; }
  }));
  const stats = new Map(statsEntries);

  const errors: Record<string, string> = {
    role: "Only owners and admins can run ads.",
    missing: "Pick a product, write the ad text, choose a Page, and set a daily budget above zero.",
    noads: "That ad account isn't connected. Reconnect on the Channels page.",
    launch: "The campaign wasn't created. The first card under Your campaigns shows which step failed and what to do.",
  };
  const saved: Record<string, string> = { launched: "Campaign created as a draft (paused). Open it in Ads Manager, review, and switch it on to start spending." };

  const itemsForBuilder = (items ?? []).map((i) => ({ id: i.id, name: i.name, imageUrl: i.image_path ? publicAssetUrl(i.image_path) : null }));

  return (
    <>
      <div className="page-head"><div><h1>Ads</h1><p>Turn a product into a Facebook or Instagram ad that drops people straight into a chat with your assistant — which then quotes, takes the order, and collects payment. Campaigns are created paused; nothing spends until you switch them on.</p></div></div>
      {sp.saved && saved[sp.saved] && <div className="notice notice-ok" role="status">{saved[sp.saved]}</div>}
      {sp.error && <div className="notice notice-bad" role="alert">{errors[sp.error] ?? "Something went wrong."}</div>}

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

      {accounts.length > 0 && (
        <section className="panel" style={{ marginTop: 16 }}>
          <h2>Your campaigns</h2>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: -6, marginBottom: 10 }}>
            <span style={{ color: "var(--ink-70)", fontSize: 13 }}>{(campaigns ?? []).length} total{failedCount ? ` · ${failedCount} failed` : ""}</span>
            {failedCount > 0 && <form action={clearFailed}><button className="btn btn-ghost btn-sm">Clear failed attempts</button></form>}
          </div>
          {(campaigns ?? []).length === 0
            ? <p style={{ color: "var(--ink-70)" }}>No campaigns yet. Create your first one above.</p>
            : <div style={{ display: "grid", gap: 10 }}>
                {(campaigns ?? []).map((c) => {
                  const st = stats.get(c.id);
                  const cur = curOf.get(c.ad_account_id) ?? "NGN";
                  const f = c.status === "failed" ? parseStoredFailure(c.last_error) : null;
                  const when = new Date(c.created_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });
                  const badge = c.status === "failed" ? ["Failed", "#FBE4E1", "#A52A1E"] : c.status === "draft" ? ["Draft · paused", "#EEF0EE", "#5B6461"] : [c.status, "#E3F5EA", "#1E7A45"];
                  const head = (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{c.product_label ?? "Boost"}</div>
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
                      {st && (st.spend || st.results) ? <div style={{ fontSize: 13, marginTop: 8 }}>Spent <b>{cur} {Number(st.spend ?? 0).toLocaleString()}</b> · <b>{st.results ?? 0}</b> chats started{st.impressions ? ` · ${Number(st.impressions).toLocaleString()} seen` : ""}</div> : null}
                      {c.meta_campaign_id && <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <a className="btn btn-line btn-sm" href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${c.ad_account_id.replace("act_", "")}&selected_campaign_ids=${c.meta_campaign_id}`} target="_blank" rel="noreferrer">Review &amp; switch on in Ads Manager ↗</a>
                        {c.status === "draft" && <span style={{ fontSize: 12, color: "var(--ink-70)" }}>Nothing spends until you switch it on there.</span>}
                      </div>}
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
