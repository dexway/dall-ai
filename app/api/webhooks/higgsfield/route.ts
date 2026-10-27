import { NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { verifyHfWebhook } from "@/lib/creative/higgsfield";
import { applyProviderStatus } from "@/lib/creative/jobs";

export const maxDuration = 60;

// Higgsfield completion notifications (Standard Webhooks signature). Unsigned or stale calls are refused.
export async function POST(req: Request) {
  const raw = await req.text();
  const ok = verifyHfWebhook({
    secret: process.env.HIGGSFIELD_WEBHOOK_SECRET ?? "", id: req.headers.get("webhook-id"),
    timestamp: req.headers.get("webhook-timestamp"), signature: req.headers.get("webhook-signature"), body: raw,
  });
  if (!ok) return new Response("bad signature", { status: 401 });
  let evt: { request_id?: string; status?: string; error?: string | null; payload?: { images?: { url: string; content_type?: string }[]; video?: { url: string; content_type?: string } } | null };
  try { evt = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  if (!evt.request_id || !evt.status) return NextResponse.json({ ok: true });
  const { data: job } = await supabaseAdmin().from("generation_jobs").select("id").eq("provider_request_id", evt.request_id).maybeSingle();
  if (!job) return NextResponse.json({ ok: true, unknown: true });
  after(async () => {
    try { await applyProviderStatus(job.id, { status: evt.status!, error: evt.error, images: evt.payload?.images, video: evt.payload?.video }); }
    catch (e) { await supabaseAdmin().from("generation_jobs").update({ error: (e as Error).message.slice(0, 400) }).eq("id", job.id); }
  });
  return NextResponse.json({ ok: true });
}
