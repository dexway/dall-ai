// Higgsfield developer API client (server-only use; no server-only import so tests can load it).
// Auth: "Authorization: Key <id>:<secret>". Every submission carries an Idempotency-Key, so a retry after
// a timeout never creates a second paid generation. Docs: https://docs.higgsfield.ai
import { createHmac, timingSafeEqual } from "node:crypto";

export const HF_BASE = "https://api.higgsfield.ai";

export type HfStatus = { status: string; request_id: string; status_url?: string; cancel_url?: string; error?: string | null;
  images?: { url: string; content_type?: string }[]; video?: { url: string; content_type?: string }; expires_at?: string };

export class HfError extends Error {
  status: number; ambiguous: boolean; body: string;
  constructor(msg: string, status: number, ambiguous: boolean, body = "") { super(msg); this.status = status; this.ambiguous = ambiguous; this.body = body; }
}

export function hfAuthHeader(keyId: string, secret: string) { return `Key ${keyId}:${secret}`; }

/**
 * Submits one generation. Network errors, timeouts and 5xx are "ambiguous" (the request may have been
 * accepted): callers mark the job uncertain and later retry with the SAME idempotency key.
 */
export async function hfSubmit(a: { keyId: string; secret: string; endpoint: string; input: Record<string, unknown>; idempotencyKey: string; webhookUrl?: string; fetcher?: typeof fetch; timeoutMs?: number }): Promise<HfStatus> {
  const path = a.endpoint.replace(/^\/+/, "");
  if (!/^[a-z0-9][a-z0-9._\-/]*$/i.test(path) || path.includes("..")) throw new HfError("Invalid model endpoint.", 0, false);
  const url = new URL(`${HF_BASE}/${path}`);
  if (a.webhookUrl) url.searchParams.set("hf_webhook", a.webhookUrl);
  let res: Response;
  try {
    res = await (a.fetcher ?? fetch)(url.toString(), {
      method: "POST",
      headers: { Authorization: hfAuthHeader(a.keyId, a.secret), "Content-Type": "application/json", "Idempotency-Key": a.idempotencyKey },
      body: JSON.stringify(a.input),
      signal: AbortSignal.timeout(a.timeoutMs ?? 20_000),
    });
  } catch (e) {
    throw new HfError(`Higgsfield did not answer: ${(e as Error).message}`, 0, true);
  }
  const text = await res.text();
  if (!res.ok) throw new HfError(`Higgsfield rejected the request (${res.status}): ${text.slice(0, 300)}`, res.status, res.status >= 500 || res.status === 429, text);
  const j = JSON.parse(text) as HfStatus;
  if (!j.request_id) throw new HfError("Higgsfield accepted the request but returned no request id.", res.status, true, text);
  return j;
}

export async function hfStatus(a: { keyId: string; secret: string; requestId: string; statusUrl?: string | null; fetcher?: typeof fetch }): Promise<HfStatus> {
  const url = a.statusUrl && a.statusUrl.startsWith(`${HF_BASE}/`) ? a.statusUrl : `${HF_BASE}/requests/${encodeURIComponent(a.requestId)}/status`;
  const res = await (a.fetcher ?? fetch)(url, { headers: { Authorization: hfAuthHeader(a.keyId, a.secret) }, signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  if (!res.ok) throw new HfError(`Status check failed (${res.status}): ${text.slice(0, 200)}`, res.status, true, text);
  return JSON.parse(text) as HfStatus;
}

export async function hfCancel(a: { keyId: string; secret: string; requestId: string; fetcher?: typeof fetch }): Promise<boolean> {
  const res = await (a.fetcher ?? fetch)(`${HF_BASE}/requests/${encodeURIComponent(a.requestId)}/cancel`, { method: "POST", headers: { Authorization: hfAuthHeader(a.keyId, a.secret) } });
  return res.status === 202;
}

/** Output URLs of a completed request (images and/or a video). */
export function hfOutputs(s: Pick<HfStatus, "images" | "video">): { url: string; contentType?: string }[] {
  return [...(s.images ?? []).map((i) => ({ url: i.url, contentType: i.content_type })), ...(s.video?.url ? [{ url: s.video.url, contentType: s.video.content_type }] : [])];
}

/**
 * Standard Webhooks verification (what Higgsfield uses): HMAC-SHA256 over "id.timestamp.body" with the
 * base64 secret after "whsec_", compared to each "v1,<sig>" entry; timestamps older than 5 minutes fail.
 */
export function verifyHfWebhook(a: { secret: string; id: string | null; timestamp: string | null; signature: string | null; body: string; now?: number }): boolean {
  if (!a.secret || !a.id || !a.timestamp || !a.signature) return false;
  const ts = Number(a.timestamp);
  if (!Number.isFinite(ts) || Math.abs((a.now ?? Date.now()) / 1000 - ts) > 300) return false;
  const key = Buffer.from(a.secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${a.id}.${a.timestamp}.${a.body}`).digest();
  return a.signature.split(" ").some((part) => {
    const [v, sig] = part.split(",");
    if (v !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
