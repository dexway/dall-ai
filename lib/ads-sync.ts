import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";
import { campaignState, dailyInsights, MetaApiError } from "@/lib/ads";
import { logIntegrationError } from "@/lib/channels/process";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Pulls status and the last `days` of daily insights for every Meta campaign a business launched from Dall AI. */
export async function syncWorkspaceAds(workspaceId: string, days = 30): Promise<{ synced: number; failed: number }> {
  const db = supabaseAdmin();
  const [{ data: camps }, { data: conns }] = await Promise.all([
    db.from("ad_campaigns").select("id,ad_account_id,meta_campaign_id").eq("workspace_id", workspaceId).not("meta_campaign_id", "is", null),
    db.from("ad_connections").select("ad_account_id,access_token_enc,status").eq("workspace_id", workspaceId),
  ]);
  const token = new Map((conns ?? []).map((c) => [c.ad_account_id, c.access_token_enc]));
  const until = new Date(), since = new Date(Date.now() - days * 86400_000);
  let synced = 0, failed = 0;
  for (const c of camps ?? []) {
    const enc = token.get(c.ad_account_id);
    if (!enc) { failed++; continue; }
    try {
      const t = decryptSecret(enc);
      const st = await campaignState(t, c.meta_campaign_id!);
      const rows = await dailyInsights(t, c.meta_campaign_id!, ymd(since), ymd(until));
      if (rows.length) {
        await db.from("ad_insights_daily").upsert(rows.filter((r) => r.day).map((r) => ({ ...r, workspace_id: workspaceId, ad_campaign_id: c.id, synced_at: new Date().toISOString() })), { onConflict: "ad_campaign_id,day" });
      }
      const status = st.status === "ACTIVE" ? "active" : st.status === "PAUSED" ? "paused" : (st.status ?? "unknown").toLowerCase();
      await db.from("ad_campaigns").update({ meta_status: st.status ?? null, effective_status: st.effective_status ?? null, status, last_synced_at: new Date().toISOString() }).eq("id", c.id);
      synced++;
    } catch (e) {
      failed++;
      const msg = (e as Error).message;
      if (e instanceof MetaApiError && /"code":\s*190/.test(e.raw)) {
        await db.from("ad_connections").update({ status: "needs_reconnect" }).eq("workspace_id", workspaceId).eq("ad_account_id", c.ad_account_id);
      }
      await logIntegrationError(workspaceId, "ads_sync", msg, { ad_campaign_id: c.id });
    }
  }
  return { synced, failed };
}
