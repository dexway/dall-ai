import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { runDueFollowups, sendBroadcast } from "@/lib/marketing";
import { pollCreativeJobs } from "@/lib/creative/jobs";
import { runAutopilot } from "@/lib/autopilot";
import { offerLaunchVideos } from "@/lib/creative/launch-offer";
import { importPendingSites } from "@/lib/creative/site-import";
import { runHarveyFollowups } from "@/lib/harvey/agent";

export const maxDuration = 300;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Called every 5 minutes by the database scheduler (pg_cron → pg_net). The bearer token is a secret
 * the database generated in Vault; we read it back with the service role and compare in constant time.
 * CRON_SECRET (if set in Vercel) also works, for manual runs.
 */
export async function POST(req: Request) {
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!given) return new Response("unauthorized", { status: 401 });
  const db = supabaseAdmin();
  const { data: vaultSecret } = await db.rpc("marketing_cron_secret");
  const ok = (typeof vaultSecret === "string" && vaultSecret && same(given, vaultSecret)) || (process.env.CRON_SECRET && same(given, process.env.CRON_SECRET));
  if (!ok) return new Response("unauthorized", { status: 401 });

  const followups = await runDueFollowups(25_000);
  // Broadcasts that are still sending (large audiences continue across runs).
  const { data: sending } = await db.from("broadcasts").select("id").eq("status", "sending").limit(3);
  for (const b of sending ?? []) await sendBroadcast(b.id, 8_000);
  // Creative generation jobs: poll provider status, store finished outputs.
  const creative = await pollCreativeJobs(15_000);
  // Autopilot: announce new deals, publish due posts, generate within the owner's cap, plan next month.
  const autopilot = await runAutopilot(120_000);
  // Businesses that just added their website get a launch video draft and a dashboard pop-up.
  let launchOffers = 0;
  try { launchOffers = await offerLaunchVideos(); } catch (e) { console.error("[cron] launch offers failed", (e as Error).message); }
  // Pull text and photos from those businesses' websites so their launch video uses real content.
  let sitesImported = 0;
  try { sitesImported = await importPendingSites(); } catch (e) { console.error("[cron] site import failed", (e as Error).message); }
  // Harvey: draft follow-ups for deals that went quiet (the owner still sends them).
  let harveyFollowups = 0;
  try { harveyFollowups = await runHarveyFollowups(); } catch (e) { console.error("[cron] harvey follow-ups failed", (e as Error).message); }
  return NextResponse.json({ followups, broadcasts: (sending ?? []).length, creative, autopilot, launchOffers, sitesImported, harveyFollowups });
}
