import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { KAPSO_TOKEN } from "@/lib/channels/send";

// Kapso: the WhatsApp provider behind "Get WhatsApp in minutes". Each Dall AI business is a Kapso
// customer on the platform's project; a Kapso setup link connects (or gives them) a WhatsApp number,
// and from then on the number works like any other WhatsApp connection in Dall AI: Kapso relays
// Meta-format webhooks to /api/webhooks/whatsapp and accepts Meta-format sends (see send.ts).
// Businesses never see Kapso: setup pages use Dall AI's colours and send them back to Dall AI.

const PLATFORM = "https://api.kapso.ai/platform/v1";
export { KAPSO_TOKEN };

export const kapsoKey = () => process.env.KAPSO_API_KEY || process.env.KAPSOAIAPKIKEY || "";
export const kapsoLive = () => Boolean(kapsoKey());

/** The secret Kapso signs relayed webhooks with (X-Webhook-Signature), derived so no extra setting is needed. */
export function kapsoWebhookSecret(): string {
  return process.env.KAPSO_WEBHOOK_SECRET || createHmac("sha256", serverEnv.encryptionKey()).update("dall-kapso-webhook").digest("hex");
}
export function kapsoSignatureValid(raw: string, given: string | null): boolean {
  if (!given || !kapsoLive()) return false;
  const want = createHmac("sha256", kapsoWebhookSecret()).update(raw).digest("hex");
  return want.length === given.length && timingSafeEqual(Buffer.from(want), Buffer.from(given));
}

async function kapso(path: string, init: { method?: string; body?: unknown } = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`${PLATFORM}${path}`, {
    method: init.method ?? "GET",
    headers: { "X-API-Key": kapsoKey(), "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = (json.error ?? json.errors ?? json.message ?? text.slice(0, 200)) as unknown;
    throw new Error(`WhatsApp setup service error ${res.status}: ${typeof err === "string" ? err : JSON.stringify(err).slice(0, 200)}`);
  }
  return (json.data ?? json) as Record<string, unknown>;
}

export async function createKapsoCustomer(name: string, workspaceId: string): Promise<string> {
  const c = await kapso("/customers", { method: "POST", body: { customer: { name: name.slice(0, 100), external_customer_id: workspaceId } } });
  return String(c.id);
}

/**
 * A setup link for the business. "existing" connects the WhatsApp Business number they already use
 * (coexistence: their phone app keeps working); "new" gives them a fresh number during setup.
 */
export async function createSetupLink(customerId: string, mode: "existing" | "new"): Promise<string> {
  const site = serverEnv.siteUrl();
  const link = await kapso(`/customers/${customerId}/setup_links`, { method: "POST", body: { setup_link: {
    success_redirect_url: `${site}/api/whatsapp/connected`,
    failure_redirect_url: `${site}/api/whatsapp/connected?failed=1`,
    meta_billing_mode: "partner_managed",
    allowed_connection_types: mode === "existing" ? ["coexistence"] : ["dedicated"],
    provision_phone_number: mode === "new",
    theme_config: { primary_color: "#C8F06A", background_color: "#0F1A14", text_color: "#F4F7F2" },
    language: "en",
  } } });
  if (!link.url) throw new Error("No setup link came back.");
  return String(link.url);
}

export type KapsoNumber = { phoneNumberId: string; customerId: string | null; wabaId: string | null; display: string | null; name: string | null };

export async function getKapsoNumber(phoneNumberId: string): Promise<KapsoNumber> {
  const n = await kapso(`/whatsapp/phone_numbers/${encodeURIComponent(phoneNumberId)}`);
  return {
    phoneNumberId: String(n.phone_number_id ?? phoneNumberId), customerId: n.customer_id ? String(n.customer_id) : null,
    wabaId: n.business_account_id ? String(n.business_account_id) : null,
    display: (n.display_phone_number as string | null) ?? null, name: (n.verified_name as string | null) ?? (n.display_name as string | null) ?? null,
  };
}

/** Relays the number's WhatsApp events to Dall AI in Meta's format, signed with Dall AI's secret. */
export async function subscribeKapsoNumber(phoneNumberId: string): Promise<void> {
  await kapso(`/whatsapp/phone_numbers/${encodeURIComponent(phoneNumberId)}/webhooks`, { method: "POST", body: { whatsapp_webhook: {
    kind: "meta", url: `${serverEnv.siteUrl()}/api/webhooks/whatsapp`, secret_key: kapsoWebhookSecret(), active: true,
  } } });
}
