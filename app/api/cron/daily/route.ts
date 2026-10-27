import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { retryStoredEvent } from "@/lib/channels/process";
import { syncWorkspaceAds } from "@/lib/ads-sync";

export const maxDuration = 60;

// Background job (Vercel Cron, daily on Hobby): retries webhook events that failed, then syncs
// campaign status and insights for every business with campaigns. Protected by CRON_SECRET.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  const db = supabaseAdmin();
  const started = Date.now();
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  const { data: failed } = await db.from("webhook_events").select("id").eq("status", "failed").lt("attempts", 5).gte("received_at", since).order("received_at").limit(50);
  const retried = { processed: 0, failed: 0, ignored: 0 };
  for (const e of failed ?? []) {
    if (Date.now() - started > 25_000) break;
    retried[await retryStoredEvent(e.id)]++;
  }
  const { data: wss } = await db.from("ad_campaigns").select("workspace_id").not("meta_campaign_id", "is", null);
  const ads = { synced: 0, failed: 0 };
  for (const ws of [...new Set((wss ?? []).map((w) => w.workspace_id))]) {
    if (Date.now() - started > 50_000) break;
    const r = await syncWorkspaceAds(ws, 7);
    ads.synced += r.synced; ads.failed += r.failed;
  }
  // Retention: webhook payloads older than 90 days are dropped; the row (id, status) is kept for audit.
  await db.from("webhook_events").update({ payload: null }).lt("received_at", new Date(Date.now() - 90 * 86400_000).toISOString()).not("payload", "is", null);
  return NextResponse.json({ retried, ads });
}
