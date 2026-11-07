import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { profileText, type BusinessProfile } from "@/lib/business-profile";
import { voicePrompt, slotsFree, callStatus, type VoiceId } from "@/lib/voice/rules";
import { buyNumber, connectNumberToVoice, createVoiceRoute, placeCall, upsertAssistant, releaseNumber, VoiceProviderError } from "@/lib/voice/providers";

// Dall AI calling: numbers, the business's voice agent, single calls and call campaigns.

const MAX_CALL_SECONDS = 600;          // no single call runs past 10 minutes
const DIAL_TIMEOUT_MIN = 15;           // a call stuck "dialing" this long is marked failed

/** The secret the voice provider sends back on every webhook, derived so no extra setting is needed. */
export function voiceWebhookSecret(): string {
  return process.env.VAPI_WEBHOOK_SECRET || createHmac("sha256", serverEnv.encryptionKey()).update("dall-voice-webhook").digest("hex");
}
export function webhookSecretOk(given: string | null): boolean {
  const want = voiceWebhookSecret();
  return !!given && given.length === want.length && timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

export function friendlyError(e: unknown): string {
  if (e instanceof VoiceProviderError) {
    if (/KYC/i.test(e.code)) return "Calling isn't switched on for Dall AI yet (telecom verification pending). Please try again later.";
    if (/BALANCE|CREDIT/i.test(e.code + e.message)) return "Calling is paused while Dall AI tops up its calling balance. Please try again later.";
    if (/NOT_AVAILABLE|TAKEN|NOT_FOUND/i.test(e.code)) return "That number was just taken. Please pick another one.";
    if (/RATE_LIMIT/i.test(e.code)) return "Too many calls at once. Your call will be retried shortly.";
    return `The phone service said: ${e.message}`;
  }
  return (e as Error).message || "Something went wrong.";
}

/** Creates or refreshes the business's voice agent from its chat assistant, profile and knowledge. */
export async function syncVoiceAgent(workspaceId: string, opts: { name?: string; voice?: VoiceId; firstMessage?: string; instructions?: string } = {}): Promise<{ id: string; providerAssistantId: string }> {
  const db = supabaseAdmin();
  const [{ data: ws }, { data: chat }, { data: cur }] = await Promise.all([
    db.from("workspaces").select("name,business_profile").eq("id", workspaceId).single(),
    db.from("agents").select("name,persona,greeting,instructions,knowledge").eq("workspace_id", workspaceId).eq("active", true).order("created_at").limit(1).maybeSingle(),
    db.from("voice_agents").select("*").eq("workspace_id", workspaceId).maybeSingle(),
  ]);
  if (!ws) throw new Error("Business not found.");
  const name = opts.name ?? cur?.name ?? chat?.name ?? "Assistant";
  const voice = (opts.voice ?? cur?.voice ?? "female_ng") as VoiceId;
  const firstMessage = opts.firstMessage ?? cur?.first_message ?? `Hello, this is ${name} from ${ws.name}. How are you today?`;
  const instructions = opts.instructions ?? cur?.instructions ?? "";
  const prompt = voicePrompt({
    agentName: name, businessName: ws.name, persona: chat?.persona ?? "", profile: profileText(ws.business_profile as BusinessProfile),
    knowledge: chat?.knowledge ?? "", instructions: [chat?.instructions, instructions].filter(Boolean).join("\n"),
  });
  const providerAssistantId = await upsertAssistant(cur?.provider_assistant_id ?? null, {
    name: `${ws.name} · ${name}`, voice, firstMessage, prompt, maxSeconds: MAX_CALL_SECONDS,
    webhookUrl: `${serverEnv.siteUrl()}/api/webhooks/voice`, webhookSecret: voiceWebhookSecret(),
  });
  const row = { workspace_id: workspaceId, name, voice, first_message: firstMessage, instructions, provider_assistant_id: providerAssistantId, synced_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const { data, error } = await db.from("voice_agents").upsert(row, { onConflict: "workspace_id" }).select("id").single();
  if (error) throw new Error(error.message);
  return { id: data.id, providerAssistantId };
}

/** Buys a number for the business and wires it to its voice agent (inbound answers, outbound dials). */
export async function provisionNumber(workspaceId: string, userId: string, e164: string, country: string): Promise<string> {
  const db = supabaseAdmin();
  const { data: row, error } = await db.from("voice_numbers").insert({ workspace_id: workspaceId, e164, country, created_by: userId }).select("id").single();
  if (error) throw new Error(error.message.includes("duplicate") ? "That number is already taken." : error.message);
  try {
    const agent = await syncVoiceAgent(workspaceId);
    const bought = await buyNumber(e164, country);
    await db.from("voice_numbers").update({ provider_number_id: bought.id }).eq("id", row.id);
    const voice = await connectNumberToVoice(e164, bought.sip, agent.providerAssistantId);
    const route = await createVoiceRoute(`Dall ${e164}`, bought.id, agent.providerAssistantId, voice.credentialId);
    await db.from("voice_numbers").update({ status: "active", voice_credential_id: voice.credentialId, voice_phone_id: voice.phoneId, provider_endpoint_id: route, error: null }).eq("id", row.id);
    return row.id;
  } catch (e) {
    await db.from("voice_numbers").update({ status: "failed", error: friendlyError(e).slice(0, 300) }).eq("id", row.id);
    throw e;
  }
}

export async function releaseVoiceNumber(workspaceId: string, numberId: string): Promise<void> {
  const db = supabaseAdmin();
  const { data: n } = await db.from("voice_numbers").select("id,provider_number_id,status").eq("id", numberId).eq("workspace_id", workspaceId).single();
  if (!n || n.status === "released") return;
  if (n.provider_number_id) await releaseNumber(n.provider_number_id);
  await db.from("voice_numbers").update({ status: "released", released_at: new Date().toISOString() }).eq("id", n.id);
  await db.from("voice_campaigns").update({ status: "paused" }).eq("number_id", n.id).eq("status", "running");
}

/** Dials one queued call row. */
async function dial(callId: string): Promise<void> {
  const db = supabaseAdmin();
  const { data: c } = await db.from("voice_calls").select("id,workspace_id,number_id,to_e164,status").eq("id", callId).single();
  if (!c || c.status !== "queued") return;
  const { data: n } = await db.from("voice_numbers").select("e164,provider_endpoint_id,status").eq("id", c.number_id).single();
  if (!n || n.status !== "active" || !n.provider_endpoint_id) {
    await db.from("voice_calls").update({ status: "failed", error: "This number isn't active." }).eq("id", c.id);
    return;
  }
  // Claim the row first so two runners can't dial the same person.
  const { data: claimed } = await db.from("voice_calls").update({ status: "dialing", started_at: new Date().toISOString() }).eq("id", c.id).eq("status", "queued").select("id");
  if (!claimed?.length) return;
  try {
    const r = await placeCall({ from: n.e164, to: c.to_e164, routeId: n.provider_endpoint_id, callId: c.id, maxSeconds: MAX_CALL_SECONDS });
    await db.from("voice_calls").update({ provider_call_id: r.providerCallId, ...(r.status === "test" ? { status: "completed", ended_at: new Date().toISOString(), ended_reason: "test mode: no real call was placed", duration_s: 0 } : {}) }).eq("id", c.id);
  } catch (e) {
    const busy = e instanceof VoiceProviderError && /RATE_LIMIT/i.test(e.code);
    await db.from("voice_calls").update(busy ? { status: "queued", started_at: null } : { status: "failed", error: friendlyError(e).slice(0, 300), ended_at: new Date().toISOString() }).eq("id", c.id);
  }
}

/** One call now (a test call or a single customer). */
export async function startSingleCall(workspaceId: string, userId: string, numberId: string, to: string, name: string | null): Promise<string> {
  const db = supabaseAdmin();
  const { data, error } = await db.from("voice_calls").insert({ workspace_id: workspaceId, number_id: numberId, to_e164: to, contact_name: name, created_by: userId }).select("id").single();
  if (error) throw new Error(error.message);
  await dial(data.id);
  return data.id;
}

/**
 * Advances running campaigns: frees stuck calls, finishes empty campaigns, and dials as many queued
 * contacts as each campaign's concurrency and minutes cap allow. Safe to run often.
 */
export async function runVoiceCampaigns(budgetMs = 20_000): Promise<number> {
  const db = supabaseAdmin();
  const started = Date.now();
  const stale = new Date(Date.now() - DIAL_TIMEOUT_MIN * 60_000).toISOString();
  await db.from("voice_calls").update({ status: "failed", error: "No answer from the phone service.", ended_at: new Date().toISOString() }).eq("status", "dialing").lt("started_at", stale);
  const { data: running } = await db.from("voice_campaigns").select("id,max_concurrent,max_minutes,minutes_used").eq("status", "running").limit(20);
  let dialled = 0;
  for (const c of running ?? []) {
    const [{ count: active }, { data: next }] = await Promise.all([
      db.from("voice_calls").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).in("status", ["dialing", "in_progress"]),
      db.from("voice_calls").select("id").eq("campaign_id", c.id).eq("status", "queued").order("created_at").limit(10),
    ]);
    if (!next?.length && !active) { await db.from("voice_campaigns").update({ status: "done", finished_at: new Date().toISOString() }).eq("id", c.id); continue; }
    const free = slotsFree({ max_concurrent: c.max_concurrent, max_minutes: c.max_minutes, minutes_used: Number(c.minutes_used) }, active ?? 0);
    if (free === 0 && Number(c.minutes_used) >= c.max_minutes) {
      await db.from("voice_calls").update({ status: "cancelled", error: "Campaign minutes cap reached." }).eq("campaign_id", c.id).eq("status", "queued");
      continue;
    }
    for (const call of (next ?? []).slice(0, free)) {
      if (Date.now() - started > budgetMs) return dialled;
      await dial(call.id);
      dialled++;
    }
  }
  return dialled;
}

/**
 * Applies a provider event to our call row: status changes, and the end-of-call report (duration,
 * transcript, summary, recording, cost). Matched by our call id in metadata, else the provider call id.
 */
export async function applyCallEvent(e: { dallCallId?: string | null; providerCallId?: string | null; status?: string | null; endedReason?: string | null; durationS?: number | null; transcript?: string | null; summary?: string | null; recordingUrl?: string | null; costUsd?: number | null; customer?: string | null }): Promise<boolean> {
  const db = supabaseAdmin();
  let q = db.from("voice_calls").select("id,campaign_id,status,duration_s");
  if (e.dallCallId) q = q.eq("id", e.dallCallId);
  else if (e.providerCallId) q = q.eq("provider_call_id", e.providerCallId);
  else return false;
  let { data: c } = await q.maybeSingle();
  // The voice side doesn't know our id: fall back to the latest live call to that customer.
  if (!c && e.customer) ({ data: c } = await db.from("voice_calls").select("id,campaign_id,status,duration_s").eq("to_e164", e.customer).in("status", ["dialing", "in_progress"]).order("created_at", { ascending: false }).limit(1).maybeSingle());
  if (!c) return false;
  const st = callStatus(e.status);
  const ended = e.durationS != null || e.transcript != null || (st && !["dialing", "in_progress"].includes(st));
  const update: Record<string, unknown> = {};
  if (st && !(["completed", "no_answer", "busy", "failed"].includes(c.status) && ["dialing", "in_progress"].includes(st))) update.status = st;
  if (ended && !update.status && ["dialing", "in_progress"].includes(c.status)) update.status = "completed";
  if (ended) update.ended_at = new Date().toISOString();
  if (e.endedReason) update.ended_reason = e.endedReason.slice(0, 200);
  if (e.durationS != null) update.duration_s = Math.round(e.durationS);
  if (e.transcript) update.transcript = e.transcript.slice(0, 50_000);
  if (e.summary) update.summary = e.summary.slice(0, 2000);
  if (e.recordingUrl) update.recording_url = e.recordingUrl.slice(0, 1000);
  if (e.costUsd != null) update.cost_usd = e.costUsd;
  if (!Object.keys(update).length) return true;
  await db.from("voice_calls").update(update).eq("id", c.id);
  // Count minutes against the campaign cap once, when the duration first arrives.
  if (c.campaign_id && e.durationS != null && c.duration_s == null) {
    const { data: camp } = await db.from("voice_campaigns").select("minutes_used").eq("id", c.campaign_id).single();
    if (camp) await db.from("voice_campaigns").update({ minutes_used: Number(camp.minutes_used) + Math.ceil(e.durationS / 6) / 10 }).eq("id", c.campaign_id);
  }
  return true;
}
