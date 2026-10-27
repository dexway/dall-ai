import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";
import { runAgentTurn } from "@/lib/ai/agent";
import { GatewayError } from "@/lib/ai/gateway";
import { AI } from "@/lib/config";
import { profileText, type BusinessProfile } from "@/lib/business-profile";
import { flagIfAuthFailure } from "@/lib/channels/health";
import { sendText } from "@/lib/channels/send";
import {
  eventKey, replyWindow, describeForAgent,
  type ChannelEvent, type MessageEvent, type Provider, type ReferralEvent, type StatusEvent, type ReadEvent, type Referral,
} from "@/lib/channels/events";

type Conn = { id: string; workspace_id: string; provider: Provider; external_id: string; access_token_enc: string; status: string };
type Conv = { id: string; workspace_id: string; agent_id: string; channel: string; external_ref: string | null; ai_paused: boolean; last_inbound_at: string | null; attribution: unknown };

const RESTING = "Sorry, this assistant is resting right now. A team member will get back to you.";
const MAX_INBOUND_PER_MINUTE = 10;

export async function logIntegrationError(workspaceId: string, source: string, message: string, context?: Record<string, unknown>) {
  await supabaseAdmin().from("integration_errors").insert({ workspace_id: workspaceId, source, message: message.slice(0, 1000), context: context ?? null });
}

/**
 * Records every event once (idempotent on provider + event key), then processes it.
 * A duplicate delivery of an event that already processed is skipped; a failed one is retried.
 */
export async function ingestEvents(provider: Provider, events: ChannelEvent[]): Promise<{ processed: number; duplicates: number; failed: number; ignored: number }> {
  const db = supabaseAdmin();
  const tally = { processed: 0, duplicates: 0, failed: 0, ignored: 0 };
  for (const ev of events) {
    const key = eventKey(ev);
    const { data: conn } = await db.from("channel_connections").select("id,workspace_id,provider,external_id,access_token_enc,status")
      .eq("provider", provider).eq("external_id", ev.accountId).maybeSingle();
    const { data: inserted } = await db.from("webhook_events").upsert({
      provider, event_key: key, kind: ev.kind, workspace_id: conn?.workspace_id ?? null, payload: ev, status: "received",
    }, { onConflict: "provider,event_key", ignoreDuplicates: true }).select("id");
    let id = inserted?.[0]?.id as string | undefined;
    if (!id) {
      const { data: prior } = await db.from("webhook_events").select("id,status").eq("provider", provider).eq("event_key", key).maybeSingle();
      if (!prior || prior.status !== "failed") { tally.duplicates++; continue; }
      id = prior.id;
    }
    if (!conn) {
      await db.from("webhook_events").update({ status: "ignored", error: "No business has this account connected.", processed_at: new Date().toISOString() }).eq("id", id);
      tally.ignored++; continue;
    }
    const r = await processOne(conn as Conn, ev, id!);
    tally[r]++;
  }
  return tally;
}

/** Re-runs one stored event (used by the retry job). */
export async function retryStoredEvent(eventId: string): Promise<"processed" | "failed" | "ignored"> {
  const db = supabaseAdmin();
  const { data: row } = await db.from("webhook_events").select("id,provider,payload,status").eq("id", eventId).maybeSingle();
  if (!row || row.status !== "failed") return "ignored";
  const ev = row.payload as ChannelEvent;
  const { data: conn } = await db.from("channel_connections").select("id,workspace_id,provider,external_id,access_token_enc,status")
    .eq("provider", row.provider).eq("external_id", ev.accountId).maybeSingle();
  if (!conn) return "ignored";
  return processOne(conn as Conn, ev, row.id);
}

async function processOne(conn: Conn, ev: ChannelEvent, eventId: string): Promise<"processed" | "failed" | "ignored"> {
  const db = supabaseAdmin();
  const { data: cur } = await db.from("webhook_events").select("attempts").eq("id", eventId).single();
  const attempts = (cur?.attempts ?? 0) + 1;
  try {
    let outcome: "processed" | "ignored" = "processed";
    if (ev.kind === "message") outcome = await handleMessage(conn, ev);
    else if (ev.kind === "referral") outcome = await handleReferral(conn, ev);
    else if (ev.kind === "status") await handleStatus(conn, ev);
    else await handleRead(conn, ev);
    await db.from("webhook_events").update({ status: outcome, attempts, error: null, processed_at: new Date().toISOString() }).eq("id", eventId);
    return outcome;
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    console.error(`[webhook] ${ev.provider} ${ev.kind} failed`, message);
    await db.from("webhook_events").update({ status: "failed", attempts, error: message.slice(0, 500) }).eq("id", eventId);
    await logIntegrationError(conn.workspace_id, "webhook", message, { provider: ev.provider, kind: ev.kind, event_id: eventId });
    return "failed";
  }
}

const attributionOf = (r: Referral | undefined) => r ? {
  attribution: { source: r.source, ad_id: r.adId ?? null, ctwa_clid: r.ctwaClid ?? null, headline: r.headline ?? null, ref: r.ref ?? null, first_seen: new Date().toISOString() },
  ad_id: r.adId ?? null,
} : {};

/** Finds or opens the customer's conversation on this channel. First-touch attribution is kept. */
async function upsertConversation(conn: Conn, contactId: string, opts: { contactName?: string; referral?: Referral; inbound: boolean }): Promise<{ conv: Conv; created: boolean } | null> {
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const { data: existing } = await db.from("conversations").select("id,workspace_id,agent_id,channel,external_ref,ai_paused,last_inbound_at,attribution,contact_name")
    .eq("workspace_id", conn.workspace_id).eq("channel", conn.provider).eq("external_ref", contactId).maybeSingle();
  if (existing) {
    const patch: Record<string, unknown> = { last_message_at: now };
    if (opts.inbound) { patch.last_inbound_at = now; patch.unread = true; }
    if (opts.contactName && !existing.contact_name) patch.contact_name = opts.contactName;
    if (opts.referral && !existing.attribution) Object.assign(patch, attributionOf(opts.referral));
    await db.from("conversations").update(patch).eq("id", existing.id);
    return { conv: { ...(existing as Conv), last_inbound_at: opts.inbound ? now : existing.last_inbound_at }, created: false };
  }
  const { data: agent } = await db.from("agents").select("id").eq("workspace_id", conn.workspace_id).eq("active", true).order("created_at").limit(1).maybeSingle();
  if (!agent) return null;
  const { data, error } = await db.from("conversations").insert({
    workspace_id: conn.workspace_id, agent_id: agent.id, channel: conn.provider, external_ref: contactId,
    contact_name: opts.contactName ?? null, last_message_at: now, last_inbound_at: opts.inbound ? now : null, unread: opts.inbound,
    ...attributionOf(opts.referral),
  }).select("id,workspace_id,agent_id,channel,external_ref,ai_paused,last_inbound_at,attribution").single();
  if (error) {
    // Two deliveries racing to open the same chat: use the one that won.
    if (error.code === "23505") return upsertConversation(conn, contactId, opts);
    throw new Error(`conversation insert failed: ${error.message}`);
  }
  return { conv: data as Conv, created: true };
}

async function handleMessage(conn: Conn, ev: MessageEvent): Promise<"processed" | "ignored"> {
  const db = supabaseAdmin();
  const opened = await upsertConversation(conn, ev.contactId, { contactName: ev.contactName, referral: ev.referral, inbound: true });
  if (!opened) return "ignored";
  const { conv } = opened;
  await db.from("channel_connections").update({ last_inbound_at: new Date().toISOString() }).eq("id", conn.id);

  const { error: mErr } = await db.from("messages").insert({
    conversation_id: conv.id, workspace_id: conn.workspace_id, role: "user",
    content: { text: ev.text }, external_id: ev.messageId, attachments: ev.attachments,
  });
  if (mErr?.code === "23505") return "ignored"; // already stored: Meta retried the same message
  if (mErr) throw new Error(`message insert failed: ${mErr.message}`);

  // The owner decides whether the assistant answers here.
  if (conn.status !== "active") return "processed";       // channel paused or needs reconnecting: inbox only
  if (conv.ai_paused) return "processed";                   // a team member took over this chat

  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id).eq("role", "user").gte("created_at", since);
  if ((count ?? 0) > MAX_INBOUND_PER_MINUTE) {
    await logIntegrationError(conn.workspace_id, "rate_limit", "Customer sent more than 10 messages in a minute; the assistant stopped replying to protect your account.", { conversation_id: conv.id });
    return "processed";
  }

  const userText = describeForAgent(ev);
  if (!userText) return "processed";
  const adNote = opened.created && ev.referral?.source === "ad" ? `\n(Context: this customer just tapped your ad${ev.referral.headline ? ` "${ev.referral.headline}"` : ""}.)` : "";
  const reply = await agentReply(conn.workspace_id, conv, userText + adNote);
  if (reply) await deliver({ conn, conv, text: reply, role: "assistant" });
  return "processed";
}

async function handleReferral(conn: Conn, ev: ReferralEvent): Promise<"processed" | "ignored"> {
  const opened = await upsertConversation(conn, ev.contactId, { referral: ev.referral, inbound: true });
  if (!opened) return "ignored";
  // Opened from an ad or link without typing: greet once, inside the window the tap opened.
  if (opened.created && conn.status === "active" && !opened.conv.ai_paused) {
    const { data: agent } = await supabaseAdmin().from("agents").select("greeting").eq("id", opened.conv.agent_id).single();
    if (agent?.greeting) await deliver({ conn, conv: opened.conv, text: agent.greeting, role: "assistant" });
  }
  return "processed";
}

const RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

async function handleStatus(conn: Conn, ev: StatusEvent) {
  const db = supabaseAdmin();
  const { data: msg } = await db.from("messages").select("id,delivery_status").eq("workspace_id", conn.workspace_id).eq("provider_message_id", ev.providerMessageId).maybeSingle();
  if (!msg) return;
  if (ev.status !== "failed" && (RANK[msg.delivery_status ?? "pending"] ?? 0) >= RANK[ev.status]) return; // never go backwards
  await db.from("messages").update({ delivery_status: ev.status, delivery_error: ev.error ?? null }).eq("id", msg.id);
  if (ev.status === "failed") await logIntegrationError(conn.workspace_id, `${conn.provider}_delivery`, `A message wasn't delivered: ${ev.error ?? "unknown reason"}`, { message_id: msg.id });
}

async function handleRead(conn: Conn, ev: ReadEvent) {
  const db = supabaseAdmin();
  const { data: conv } = await db.from("conversations").select("id").eq("workspace_id", conn.workspace_id).eq("channel", conn.provider).eq("external_ref", ev.contactId).maybeSingle();
  if (!conv) return;
  await db.from("messages").update({ delivery_status: "read" }).eq("conversation_id", conv.id)
    .in("role", ["assistant", "human"]).in("delivery_status", ["sent", "delivered"]).lte("created_at", new Date(ev.watermark).toISOString());
}

/** Runs the business's shared agent on one customer message. Returns null when nothing should be sent. */
async function agentReply(workspaceId: string, conv: Conv, userText: string): Promise<string | null> {
  const db = supabaseAdmin();
  const [{ data: ws }, { data: agent }, { data: past }] = await Promise.all([
    db.from("workspaces").select("id,name,status,business_profile").eq("id", workspaceId).single(),
    db.from("agents").select("id,workspace_id,name,role_title,persona,languages,greeting,max_discount_pct,instructions,knowledge").eq("id", conv.agent_id).single(),
    db.from("messages").select("role,content").eq("conversation_id", conv.id).order("created_at", { ascending: false }).limit(AI.maxHistoryMessages + 1),
  ]);
  if (!ws || ws.status !== "active" || !agent) return null;
  // History excludes the message we just stored (it is passed as userText).
  const history: Anthropic.MessageParam[] = (past ?? []).slice(1).reverse()
    .map((m) => ({ role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant", content: String((m.content as { text?: string }).text ?? "") }))
    .filter((m) => m.content);
  try {
    return await runAgentTurn({ agent, businessName: ws.name, conversationId: conv.id, history, userText, profile: profileText(ws.business_profile as BusinessProfile) });
  } catch (e) {
    if (e instanceof GatewayError) {
      if (e.status === 402 || e.status === 403) return RESTING;
      // Provider outage: don't send an error to the customer; flag the chat for a human instead.
      await db.from("conversations").update({ unread: true, handoff_reason: "The assistant couldn't reply (AI service error). Please reply by hand." }).eq("id", conv.id);
      await logIntegrationError(workspaceId, "ai", `Assistant reply failed: ${e.code}`, { conversation_id: conv.id });
      return null;
    }
    throw e;
  }
}

export type DeliverResult = { ok: true; messageId: string } | { ok: false; error: string; needsTemplate?: boolean };

/**
 * Sends one outbound message and stores it with its real delivery state.
 * Used by the assistant and by team members replying from the inbox.
 */
export async function deliver(a: { conn: Conn; conv: Pick<Conv, "id" | "workspace_id" | "external_ref" | "last_inbound_at">; text: string; role: "assistant" | "human"; sentBy?: string }): Promise<DeliverResult> {
  const db = supabaseAdmin();
  const win = replyWindow(a.conn.provider, a.conv.last_inbound_at, a.role === "human" ? "human" : "agent");
  const base = { conversation_id: a.conv.id, workspace_id: a.conv.workspace_id, role: a.role, content: { text: a.text }, sent_by: a.sentBy ?? null };
  if (!win.ok) {
    await db.from("messages").insert({ ...base, delivery_status: "failed", delivery_error: win.reason });
    return { ok: false, error: win.reason, needsTemplate: win.needsTemplate };
  }
  try {
    const { providerMessageId } = await sendText({ provider: a.conn.provider, token: decryptSecret(a.conn.access_token_enc), accountId: a.conn.external_id, to: a.conv.external_ref!, text: a.text, tag: win.tag });
    const { data } = await db.from("messages").insert({ ...base, delivery_status: "sent", provider_message_id: providerMessageId }).select("id").single();
    await Promise.all([
      db.from("conversations").update({ last_message_at: new Date().toISOString(), ...(a.role === "human" ? { unread: false } : {}) }).eq("id", a.conv.id),
      db.from("channel_connections").update({ last_outbound_at: new Date().toISOString() }).eq("id", a.conn.id),
    ]);
    return { ok: true, messageId: data?.id ?? "" };
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    await db.from("messages").insert({ ...base, delivery_status: "failed", delivery_error: message.slice(0, 300) });
    await flagIfAuthFailure(a.conn.provider, a.conn.external_id, e);
    await logIntegrationError(a.conv.workspace_id, `${a.conn.provider}_send`, message, { conversation_id: a.conv.id });
    return { ok: false, error: message };
  }
}

export async function connectionFor(workspaceId: string, provider: string, externalId?: string) {
  let q = supabaseAdmin().from("channel_connections").select("id,workspace_id,provider,external_id,access_token_enc,status,waba_id").eq("workspace_id", workspaceId).eq("provider", provider);
  if (externalId) q = q.eq("external_id", externalId);
  const { data } = await q.limit(1).maybeSingle();
  return data as (Conn & { waba_id: string | null }) | null;
}
