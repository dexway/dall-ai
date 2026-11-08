import "server-only";
import { lookup } from "node:dns/promises";
import { inventoryE164, isoFromCalling, numberPriceNgn, type VoiceId } from "@/lib/voice/rules";

// The two providers behind Dall AI calling, used only from the server and never shown to businesses:
// the telecom provider (KrosAI: numbers, carrier, KYC, dialling) and the voice provider (Vapi: the
// voice agent). Both run on the platform's own accounts. With a key missing, a clearly labelled test
// mode stands in so the flow can be tried without buying anything or dialling anyone.

const KROS = "https://api.krosai.com/api/v1";
const VAPI = "https://api.vapi.ai";
const TIMEOUT = 20_000;

export class VoiceProviderError extends Error {
  constructor(public provider: "telecom" | "voice", public status: number, public code: string, message: string) { super(message); }
}

export const telecomLive = () => Boolean(process.env.KROSAI_API_KEY);
export const voiceLive = () => Boolean(process.env.VAPI_API_KEY);

async function call(provider: "telecom" | "voice", url: string, key: string, init: { method?: string; body?: unknown } = {}): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const detail = json.detail as Record<string, unknown> | string | undefined;
    const code = String(json.error ?? json.code ?? (typeof detail === "object" ? detail?.error : "") ?? `HTTP_${res.status}`);
    const msg = String(json.message ?? (typeof detail === "string" ? detail : (detail as Record<string, unknown> | undefined)?.message) ?? text.slice(0, 200) ?? res.statusText);
    throw new VoiceProviderError(provider, res.status, code || `HTTP_${res.status}`, msg.slice(0, 300));
  }
  return json;
}
const kros = (path: string, init?: { method?: string; body?: unknown }) => call("telecom", `${KROS}${path}`, process.env.KROSAI_API_KEY!, init);
const vapi = (path: string, init?: { method?: string; body?: unknown }) => call("voice", `${VAPI}${path}`, process.env.VAPI_API_KEY!, init);
const pick = (o: Record<string, unknown> | undefined, ...keys: string[]) => { for (const k of keys) if (o?.[k] != null && o[k] !== "") return String(o[k]); return null; };
const unwrap = (j: Record<string, unknown>) => (j.data && typeof j.data === "object" && !Array.isArray(j.data) ? j.data as Record<string, unknown> : j);

// ---------- Telecom: numbers and dialling ----------

export type AvailableNumber = { raw: string; e164: string; country: string; monthlyCostUsd: number | null; priceNgn: number | null; capabilities: string[] };

/**
 * Numbers the business can buy in one country. The provider may return other countries when a country
 * has no stock, so results are filtered to the country asked for. `raw` is the provider's own number
 * string, which is what buying must send back.
 */
export async function searchNumbers(country: string, contains?: string): Promise<AvailableNumber[]> {
  if (!telecomLive()) {
    const base = country === "NG" ? "20100" : "55510";
    return [1, 2, 3, 4, 5].map((i) => { const raw = `${base}${String(i).padStart(5, "0")}`; return { raw, e164: inventoryE164(raw, country), country, monthlyCostUsd: null, priceNgn: numberPriceNgn(3), capabilities: ["voice"] }; });
  }
  const q = new URLSearchParams({ country_code: country, limit: "30" });
  if (contains) q.set("contains", contains.replace(/\D/g, "").slice(0, 8));
  const j = await kros(`/phone-numbers/available?${q}`);
  const list = (Array.isArray(j) ? j : (j.data ?? j.numbers ?? j.items ?? [])) as Record<string, unknown>[];
  return list.map((n) => {
    const raw = String(n.number ?? n.phone_number ?? n.e164 ?? "");
    const rc = String(n.country_code ?? n.country ?? country).toUpperCase();
    const iso = isoFromCalling(rc);
    const cost = Number(n.monthly_cost ?? n.monthly_price ?? n.price);
    return { raw, e164: inventoryE164(raw, iso), country: iso, monthlyCostUsd: Number.isFinite(cost) ? cost : null, priceNgn: numberPriceNgn(Number.isFinite(cost) ? cost : null), capabilities: Array.isArray(n.capabilities) ? (n.capabilities as unknown[]).map(String) : [] };
  }).filter((n) => n.raw && n.country === country);
}

// A number's SIP login as KrosAI returns it: sip_username, sip_password, sip_domain (voip.krosai.com),
// sip_port (5070), sip_transport (UDP); sip_ip_address is often null.
type Sip = { username: string; password: string; host: string; port: number; protocol: "udp" | "tcp" | "tls" };
const sipOf = (row: Record<string, unknown>): Sip | null => {
  const username = pick(row, "sip_username"), password = pick(row, "sip_password");
  const host = pick(row, "sip_ip_address", "sip_domain");
  if (!username || !password || !host) return null;
  const t = String(row.sip_transport ?? "udp").toLowerCase();
  return { username, password, host, port: Number(row.sip_port) || 5060, protocol: t === "tcp" ? "tcp" : t === "tls" ? "tls" : "udp" };
};

/**
 * Buys a number in direct-SIP mode. The provider's docs ask for E.164 (+2342018893078); if it refuses
 * that form, the number is retried exactly as its inventory listed it. Returns the provider's id.
 */
export async function buyNumber(e164: string, raw: string, country: string): Promise<string> {
  if (!telecomLive()) return `test_${e164.replace(/\D/g, "")}`;
  const attempt = (number: string) => kros("/phone-numbers", { method: "POST", body: { number, country_code: country, allow_inbound: true, allow_outbound: true, routing_mode: "direct_sip" } });
  let bought: Record<string, unknown>;
  try { bought = unwrap(await attempt(e164)); }
  catch (e) {
    if (!(e instanceof VoiceProviderError) || e.status >= 500 || raw === e164 || /BALANCE|CREDIT|KYC|LIMIT/i.test(e.code + e.message)) throw e;
    bought = unwrap(await attempt(raw));
  }
  const id = pick(bought, "id", "phone_number_id");
  if (!id) throw new VoiceProviderError("telecom", 502, "NO_ID", "The number was bought but no id came back.");
  return id;
}

/**
 * The number's SIP login, which the voice provider uses to carry its calls. If the number has none yet,
 * switch it to direct-SIP routing, which makes the provider generate one.
 */
export async function numberSip(id: string): Promise<Sip | null> {
  if (!telecomLive() || id.startsWith("test_")) return { username: "test", password: "test", host: "203.0.113.1", port: 5060, protocol: "udp" };
  let sip = sipOf(unwrap(await kros(`/phone-numbers/${id}`)));
  if (!sip) {
    await kros(`/phone-numbers/${id}/attach-endpoint`, { method: "POST", body: { routing_mode: "direct_sip" } });
    sip = sipOf(unwrap(await kros(`/phone-numbers/${id}`)));
  }
  return sip;
}

export async function releaseNumber(id: string): Promise<void> {
  if (!telecomLive() || id.startsWith("test_")) return;
  await kros(`/phone-numbers/${id}`, { method: "DELETE" });
}

/**
 * The telecom account must hold the platform's voice-provider key to hand calls to the voice agents
 * (KrosAI: Settings → Integrations → Vapi). Done once, server to server; the key is never shown.
 */
let voiceLinked = false;
export async function ensureTelecomVoiceLink(): Promise<void> {
  if (voiceLinked || !telecomLive() || !voiceLive()) return;
  const j = await kros("/provider-integrations");
  const list = (Array.isArray(j) ? j : (j.data ?? j.integrations ?? j.items ?? [])) as Record<string, unknown>[];
  const vapiRow = list.find((i) => String(i.provider ?? "").toLowerCase() === "vapi");
  if (!vapiRow || vapiRow.is_connected === false) {
    await kros("/provider-integrations", { method: "POST", body: { provider: "vapi", display_name: "Dall AI voice", api_key: process.env.VAPI_API_KEY, is_connected: true } });
  }
  voiceLinked = true;
}

/** A route on the telecom side that hands calls on this number to the voice agent. */
export async function createVoiceRoute(name: string, numberId: string, assistantId: string, voiceCredentialId: string | null): Promise<string> {
  if (!telecomLive()) return `test_route_${numberId}`;
  const j = unwrap(await kros("/endpoints", { method: "POST", body: {
    name: name.slice(0, 80), type: "vapi", status: "active", phone_number_ids: [numberId],
    provider_config: {
      assistant_id: assistantId, vapi_assistant_id: assistantId,
      ...(voiceCredentialId ? { sip_trunk_credential_id: voiceCredentialId, vapi_sip_trunk_credential_id: voiceCredentialId, credential_id: voiceCredentialId } : {}),
    },
  } }));
  const id = pick(j, "id", "endpoint_id");
  if (!id) throw new VoiceProviderError("telecom", 502, "NO_ID", "The call route was created but no id came back.");
  return id;
}

export async function placeCall(a: { from: string; to: string; routeId: string; callId: string; maxSeconds: number }): Promise<{ providerCallId: string; status: string }> {
  if (!telecomLive()) return { providerCallId: `test_${a.callId}`, status: "test" };
  const j = unwrap(await kros("/calls", { method: "POST", body: {
    from_number: a.from, to_number: a.to, endpoint_id: a.routeId, metadata: { dall_call_id: a.callId }, max_duration: a.maxSeconds,
  } }));
  return { providerCallId: pick(j, "call_id", "id", "call_uuid") ?? a.callId, status: pick(j, "status") ?? "initiated" };
}

export async function hangUp(providerCallId: string): Promise<void> {
  if (!telecomLive() || providerCallId.startsWith("test_")) return;
  await kros(`/calls/${providerCallId}/hangup`, { method: "POST" });
}

// ---------- Voice: the agent ----------

// Dall AI voice choices → provider voices. VOICE_MAP (JSON, set by the platform) overrides, e.g. to use
// Nigerian-accented voices once chosen: {"female_ng":{"provider":"11labs","voiceId":"..."}}.
const DEFAULT_VOICES: Record<VoiceId, { provider: string; voiceId: string }> = {
  female_ng: { provider: "vapi", voiceId: "Savannah" }, male_ng: { provider: "vapi", voiceId: "Rohan" },
  female_neutral: { provider: "vapi", voiceId: "Paige" }, male_neutral: { provider: "vapi", voiceId: "Elliot" },
};
function voiceFor(v: VoiceId) {
  try { const m = JSON.parse(process.env.VOICE_MAP ?? "{}"); if (m[v]?.provider && m[v]?.voiceId) return m[v]; } catch { /* bad map: defaults */ }
  return DEFAULT_VOICES[v];
}

export type AssistantSpec = { name: string; voice: VoiceId; firstMessage: string; prompt: string; webhookUrl: string; webhookSecret: string; maxSeconds: number };

function assistantBody(s: AssistantSpec) {
  return {
    name: s.name.slice(0, 40), firstMessage: s.firstMessage.slice(0, 500), firstMessageMode: "assistant-speaks-first",
    model: { provider: "openai", model: "gpt-4o-mini", messages: [{ role: "system", content: s.prompt }] },
    voice: voiceFor(s.voice),
    transcriber: { provider: "deepgram", model: "nova-2", language: "en" },
    maxDurationSeconds: s.maxSeconds,
    server: { url: s.webhookUrl, secret: s.webhookSecret },
    serverMessages: ["end-of-call-report", "status-update"],
    endCallPhrases: ["goodbye", "bye bye"],
  };
}

/** Creates the voice agent, or updates it in place when it already exists. Returns its id. */
export async function upsertAssistant(existingId: string | null, s: AssistantSpec): Promise<string> {
  if (!voiceLive()) return existingId ?? `test_assistant_${Date.now()}`;
  if (existingId && !existingId.startsWith("test_")) {
    await vapi(`/assistant/${existingId}`, { method: "PATCH", body: assistantBody(s) });
    return existingId;
  }
  const j = await vapi("/assistant", { method: "POST", body: assistantBody(s) });
  return String(j.id);
}

/** Gives the voice provider the number's SIP login and imports the number with the agent attached. */
export async function connectNumberToVoice(e164: string, sip: Sip | null, assistantId: string): Promise<{ credentialId: string | null; phoneId: string | null }> {
  if (!voiceLive() || !sip) return { credentialId: null, phoneId: null };
  // The voice provider needs an IPv4 address for the gateway; KrosAI gives a host name.
  const ip = /^\d+\.\d+\.\d+\.\d+$/.test(sip.host) ? sip.host : (await lookup(sip.host, { family: 4 })).address;
  const cred = await vapi("/credential", { method: "POST", body: {
    provider: "byo-sip-trunk", name: `dall ${e164}`.slice(0, 40),
    gateways: [{ ip, port: sip.port, outboundProtocol: sip.protocol, inboundEnabled: true, outboundEnabled: true }],
    outboundAuthenticationPlan: { authUsername: sip.username, authPassword: sip.password }, outboundLeadingPlusEnabled: true,
  } });
  const phone = await vapi("/phone-number", { method: "POST", body: {
    provider: "byo-phone-number", name: e164, number: e164, numberE164CheckEnabled: true, credentialId: cred.id, assistantId,
  } });
  return { credentialId: String(cred.id), phoneId: String(phone.id) };
}
