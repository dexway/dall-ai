import { NextResponse, after } from "next/server";
import { applyCallEvent, runVoiceCampaigns, webhookSecretOk } from "@/lib/voice/service";

// Call events from the voice provider (the agent's end-of-call report: transcript, summary, recording)
// and the telecom provider (call status and duration). Both must carry Dall AI's webhook secret: the
// voice provider sends it as x-vapi-secret; the telecom webhook is registered with ?s=<secret>.

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : null);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

export async function POST(req: Request) {
  const url = new URL(req.url);
  if (!webhookSecretOk(req.headers.get("x-vapi-secret") ?? url.searchParams.get("s"))) return new Response("unauthorized", { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false }, { status: 400 });

  // Voice provider: { message: { type, call, ... } }
  const m = body.message as Record<string, unknown> | undefined;
  if (m && typeof m.type === "string") {
    const call = (m.call ?? {}) as Record<string, unknown>;
    const customer = str((call.customer as Record<string, unknown> | undefined)?.number);
    if (m.type === "status-update") {
      await applyCallEvent({ providerCallId: str(call.id), customer, status: str(m.status) });
    } else if (m.type === "end-of-call-report") {
      const artifact = (m.artifact ?? {}) as Record<string, unknown>;
      const analysis = (m.analysis ?? {}) as Record<string, unknown>;
      await applyCallEvent({
        providerCallId: str(call.id), customer, status: "completed", endedReason: str(m.endedReason),
        durationS: num(m.durationSeconds), transcript: str(artifact.transcript ?? m.transcript), summary: str(analysis.summary ?? m.summary),
        recordingUrl: str(artifact.recordingUrl ?? m.recordingUrl), costUsd: num(m.cost),
      });
      after(() => runVoiceCampaigns(8_000).then(() => undefined));   // a line just freed up: dial the next contact
    }
    return NextResponse.json({ ok: true });
  }

  // Telecom provider: { event, call_id, status, duration, metadata: { dall_call_id } }
  const meta = (body.metadata ?? (body.data as Record<string, unknown> | undefined)?.metadata ?? {}) as Record<string, unknown>;
  const event = str(body.event) ?? "";
  await applyCallEvent({
    dallCallId: str(meta.dall_call_id), providerCallId: str(body.call_id ?? body.call_uuid),
    status: str(body.status) ?? (event.startsWith("call.") ? event.slice(5) : null),
    durationS: event === "call.completed" || body.duration != null ? num(body.duration ?? body.duration_seconds) : null,
    endedReason: str(body.hangup_cause ?? body.end_reason),
    transcript: str(body.transcript), customer: str(body.to_number),
  });
  return NextResponse.json({ ok: true });
}
