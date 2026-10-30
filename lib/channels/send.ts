// Outbound messages on WhatsApp, Messenger and Instagram. Every send returns the platform's
// message id or throws: callers record "failed" and the error, never a fake success.
import type { Provider } from "@/lib/channels/events";

const graph = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || process.env.WHATSAPP_GRAPH_VERSION || "v26.0"}`;

export class SendError extends Error {
  status: number; retryable: boolean;
  constructor(message: string, status: number, retryable: boolean) { super(message); this.status = status; this.retryable = retryable; }
}

/** POST with one retry on rate limits (429) and server errors (5xx). */
export async function postWithRetry(url: string, token: string, body: unknown, fetcher: typeof fetch = fetch, waitMs = 800): Promise<Record<string, unknown>> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetcher(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const text = await res.text();
    if (res.ok) { try { return JSON.parse(text); } catch { return {}; } }
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt === 0) { await new Promise((r) => setTimeout(r, waitMs)); continue; }
    throw new SendError(`send failed ${res.status}: ${text.slice(0, 300)}`, res.status, retryable);
  }
}

export type SendArgs = {
  provider: Provider; token: string; accountId: string; to: string; text: string;
  tag?: "HUMAN_AGENT"; fetcher?: typeof fetch;
};

/** Sends free-form text. Check replyWindow() first; Meta rejects free-form text outside the window. */
export async function sendText(a: SendArgs): Promise<{ providerMessageId: string | null }> {
  if (a.provider === "whatsapp") {
    const r = await postWithRetry(`${graph()}/${a.accountId}/messages`, a.token, {
      messaging_product: "whatsapp", to: a.to, type: "text", text: { body: a.text.slice(0, 4000), preview_url: false },
    }, a.fetcher);
    return { providerMessageId: (r.messages as { id?: string }[] | undefined)?.[0]?.id ?? null };
  }
  const r = await postWithRetry(`${graph()}/me/messages`, a.token, {
    recipient: { id: a.to }, message: { text: a.text.slice(0, 2000) },
    ...(a.tag ? { messaging_type: "MESSAGE_TAG", tag: a.tag } : { messaging_type: "RESPONSE" }),
  }, a.fetcher);
  return { providerMessageId: (r.message_id as string | undefined) ?? null };
}

/** WhatsApp approved template (needed more than 24h after the customer's last message). */
export async function sendTemplate(a: { token: string; phoneNumberId: string; to: string; name: string; language: string; params?: string[]; fetcher?: typeof fetch }): Promise<{ providerMessageId: string | null }> {
  const components = a.params?.length ? [{ type: "body", parameters: a.params.map((text) => ({ type: "text", text })) }] : undefined;
  const r = await postWithRetry(`${graph()}/${a.phoneNumberId}/messages`, a.token, {
    messaging_product: "whatsapp", to: a.to, type: "template", template: { name: a.name, language: { code: a.language }, ...(components ? { components } : {}) },
  }, a.fetcher);
  return { providerMessageId: (r.messages as { id?: string }[] | undefined)?.[0]?.id ?? null };
}

/** How many numbered {{n}} variables a template body has; null when it uses named variables (not supported). */
export function templateVars(body: string): number | null {
  const names = [...body.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]);
  if (names.some((n) => !/^\d+$/.test(n))) return null;
  return names.reduce((max, n) => Math.max(max, Number(n)), 0);
}

/** Approved templates on a WhatsApp Business Account, for the inbox's template picker. */
export async function listTemplates(token: string, wabaId: string, fetcher: typeof fetch = fetch): Promise<{ name: string; language: string; body: string; vars: number | null }[]> {
  const res = await fetcher(`${graph()}/${wabaId}/message_templates?status=APPROVED&limit=50&fields=name,language,components`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new SendError(`templates failed ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status, false);
  const j = (await res.json()) as { data?: { name: string; language: string; components?: { type: string; text?: string }[] }[] };
  return (j.data ?? []).map((t) => { const body = t.components?.find((c) => c.type === "BODY")?.text ?? ""; return { name: t.name, language: t.language, body, vars: templateVars(body) }; });
}
