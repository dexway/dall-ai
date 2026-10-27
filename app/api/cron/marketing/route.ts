import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { runDueFollowups, sendBroadcast } from "@/lib/marketing";
import { pollCreativeJobs } from "@/lib/creative/jobs";

export const maxDuration = 60;

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
  return NextResponse.json({ followups, broadcasts: (sending ?? []).length, creative });
}
