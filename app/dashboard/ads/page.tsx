import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace, canManage } from "@/lib/workspace";
import { supabaseAdmin, publicAssetUrl } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";
import { launchClickToChatAd, type AdDestination } from "@/lib/meta";

export const metadata = { title: "Ads" };

const DEST_LABEL: Record<AdDestination, string> = {
  whatsapp: "WhatsApp chat", messenger: "Messenger chat", instagram: "Instagram DM",
};

async function launchAd(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/ads?error=role");
  const db = supabaseAdmin();

  const itemId = String(formData.get("item_id") ?? "");
  const destination = String(formData.get("destination") ?? "whatsapp") as AdDestination;
  const budget = Math.round(Number(formData.get("budget") ?? 0));
  const message = String(formData.get("message") ?? "").trim().slice(0, 600);
  if (!itemId || !message || !(budget > 0)) redirect("/dashboard/ads?error=missing");

  const [{ data: adConn }, { data: page }, { data: item }] = await Promise.all([
    db.from("ad_connections").select("ad_account_id,access_token_enc,currency").eq("workspace_id", ctx.workspace.id).eq("status", "active").maybeSingle(),
    db.from("channel_connections").select("external_id").eq("workspace_id", ctx.workspace.id).eq("provider", "facebook").eq("status", "active").maybeSingle(),
    db.from("catalogue_items").select("name,image_path").eq("workspace_id", ctx.workspace.id).eq("id", itemId).maybeSingle(),
  ]);
  if (!adConn) redirect("/dashboard/ads?error=noads");
  if (!page) redirect("/dashboard/ads?error=nopage");

  const name = `Dall AI · ${item?.name ?? "Boost"} · ${new Date().toISOString().slice(0, 10)}`;
  const imageUrl = item?.image_path ? publicAssetUrl(item.image_path) : null;

  let ids;
  try {
    ids = await launchClickToChatAd({
      adAccountId: adConn.ad_account_id, token: decryptSecret(adConn.access_token_enc), pageId: page.external_id,
      destination, name, message, dailyBudgetMinor: budget * 100, imageUrl,
    });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[ads] launch failed", msg);
    await db.from("ad_campaigns").insert({
      workspace_id: ctx.workspace.id, ad_account_id: adConn.ad_account_id, product_label: item?.name ?? null,
      destination, message, daily_budget_minor: budget * 100, status: "failed", last_error: msg.slice(0, 500), created_by: ctx.user.id,
    });
    redirect("/dashboard/ads?error=launch");
  }

  await db.from("ad_campaigns").insert({
    workspace_id: ctx.workspace.id, ad_account_id: adConn.ad_account_id, product_label: item?.name ?? null,
    destination, message, daily_budget_minor: budget * 100,
    meta_campaign_id: ids.campaignId, meta_adset_id: ids.adsetId, meta_creative_id: ids.creativeId, meta_ad_id: ids.adId,
    status: "draft", created_by: ctx.user.id,
  });
  await db.from("financial_audit_logs").insert({ workspace_id: ctx.workspace.id, actor_id: ctx.user.id, action: "ads.campaign_created", entity: "ad_campaign", entity_id: ids.campaignId, details: { destination, budget_minor: budget * 100, product: item?.name } });
  revalidatePath("/dashboard/ads");
  redirect("/dashboard/ads?saved=launched");
}

export default async function AdsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireWorkspace();
  const sp = await searchParams;
  const db = supabaseAdmin();
  const [{ data: adConn }, { data: page }, { data: items }, { data: campaigns }] = await Promise.all([
    db.from("ad_connections").select("ad_account_id,name,currency,status").eq("workspace_id", ctx.workspace.id).eq("status", "active").maybeSingle(),
    db.from("channel_connections").select("external_id,display_name").eq("workspace_id", ctx.workspace.id).eq("provider", "facebook").eq("status", "active").maybeSingle(),
    db.from("catalogue_items").select("id,name,price_kobo").eq("workspace_id", ctx.workspace.id).eq("active", true).order("name"),
    db.from("ad_campaigns").select("id,product_label,destination,daily_budget_minor,status,last_error,meta_campaign_id,created_at").eq("workspace_id", ctx.workspace.id).order("created_at", { ascending: false }).limit(20),
  ]);

  const cur = adConn?.currency ?? "NGN";
  const errors: Record<string, string> = {
    role: "Only owners and admins can run ads.",
    missing: "Pick a product, write the ad text, and set a daily budget above zero.",
    noads: "No ad account connected. Connect one on the Connect page first.",
    nopage: "Connect a Facebook Page first — click-to-chat ads run from a Page.",
    launch: "Meta did not accept the campaign. See the failed campaign below for the reason.",
  };
  const saved: Record<string, string> = { launched: "Campaign created as a draft (paused). Open it in Ads Manager, review, and switch it on to start spending." };

  return (
    <>
      <div className="page-head"><div><h1>Ads</h1><p>Run Facebook and Instagram ads that drop people straight into a chat with your assistant. Campaigns are created paused — nothing spends until you switch them on.</p></div></div>
      {sp.saved && saved[sp.saved] && <div className="notice notice-ok" role="status">{saved[sp.saved]}</div>}
      {sp.error && <div className="notice notice-bad" role="alert">{errors[sp.error] ?? "Something went wrong."}</div>}

      {!adConn ? (
        <section className="panel"><h2>Connect an ad account</h2><p style={{ color: "var(--ink-70)" }}>You haven't connected a Meta ad account yet. Go to <a href="/dashboard/connect">Connect</a>, log in with Facebook, and grant ads access.</p></section>
      ) : (
        <>
          <section className="panel">
            <h2>Boost a product</h2>
            <p style={{ color: "var(--ink-70)", fontSize: 14 }}>
              Ad account: <b>{adConn.name ?? adConn.ad_account_id}</b> ({cur}){page ? <> · Page: <b>{page.display_name ?? page.external_id}</b></> : <> · <span style={{ color: "var(--bad, #b00)" }}>no Facebook Page connected</span></>}
            </p>
            {(items ?? []).length === 0
              ? <p style={{ color: "var(--ink-70)" }}>Add a product in your <a href="/dashboard/catalogue">Catalogue</a> first.</p>
              : <form action={launchAd} style={{ display: "grid", gap: 12, maxWidth: 560 }}>
                  <label>Product<br /><select name="item_id" required style={{ width: "100%" }}>
                    {(items ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select></label>
                  <label>Where the ad sends people<br /><select name="destination" defaultValue="whatsapp" style={{ width: "100%" }}>
                    <option value="whatsapp">WhatsApp chat</option>
                    <option value="messenger">Messenger chat</option>
                    <option value="instagram">Instagram DM</option>
                  </select></label>
                  <label>Daily budget ({cur})<br /><input name="budget" type="number" min="1" step="1" defaultValue="2000" required style={{ width: "100%" }} /></label>
                  <label>Ad text<br /><textarea name="message" rows={3} required maxLength={600} defaultValue="Chat with us now to order — fast replies, pay by transfer." style={{ width: "100%" }} /></label>
                  <button className="btn btn-lime" disabled={!page}>Create draft campaign</button>
                  <p style={{ color: "var(--ink-70)", fontSize: 13, margin: 0 }}>This creates a paused campaign. You review and switch it on in Meta Ads Manager — nothing spends until then.</p>
                </form>}
          </section>

          <section className="panel" style={{ marginTop: 16 }}>
            <h2>Your campaigns</h2>
            {(campaigns ?? []).length === 0
              ? <p style={{ color: "var(--ink-70)" }}>No campaigns yet.</p>
              : <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {(campaigns ?? []).map((c) => (
                    <li key={c.id} style={{ marginBottom: 6 }}>
                      <b>{c.product_label ?? "Boost"}</b> → {DEST_LABEL[c.destination as AdDestination] ?? c.destination} · {cur} {(c.daily_budget_minor / 100).toLocaleString()}/day · {c.status === "draft" ? "draft (paused)" : c.status}
                      {c.status === "failed" && c.last_error ? <div style={{ color: "var(--bad, #b00)", fontSize: 12 }}>{c.last_error}</div> : null}
                      {c.meta_campaign_id ? <> · <a href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${(adConn.ad_account_id || "").replace("act_", "")}&selected_campaign_ids=${c.meta_campaign_id}`} target="_blank" rel="noreferrer">open in Ads Manager</a></> : null}
                    </li>
                  ))}
                </ul>}
          </section>
        </>
      )}
    </>
  );
}
