// Pure WhatsApp Cloud API helpers (no server-only import, so the unit tests can load them).
import { createHmac, timingSafeEqual } from "node:crypto";

export type Inbound = { phoneNumberId: string; from: string; messageId: string; text: string; name?: string; type: string };

/** Meta signs the raw body with the app secret: header is "sha256=<hex>". */
export function signatureValid(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !header.startsWith("sha256=") || !appSecret) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Flattens a webhook payload into inbound messages. Non-text messages come through with empty text. */
export function parseInbound(body: unknown): Inbound[] {
  const out: Inbound[] = [];
  const entries = (body as { entry?: unknown[] } | null)?.entry ?? [];
  for (const e of entries as { changes?: { value?: Record<string, unknown> }[] }[]) {
    for (const c of e.changes ?? []) {
      const v = c.value as {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id: string; profile?: { name?: string } }[];
        messages?: { id: string; from: string; type: string; text?: { body?: string } }[];
      } | undefined;
      const phoneNumberId = v?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const names = new Map((v?.contacts ?? []).map((k) => [k.wa_id, k.profile?.name]));
      for (const m of v?.messages ?? []) {
        out.push({
          phoneNumberId, from: m.from, messageId: m.id, type: m.type,
          text: m.type === "text" ? (m.text?.body ?? "") : "",
          name: names.get(m.from),
        });
      }
    }
  }
  return out;
}

/** Sends a plain text reply through the Cloud API. Only used inside the 24-hour window after a customer message. */
export async function sendText(args: { accessToken: string; phoneNumberId: string; to: string; text: string }): Promise<void> {
  const graph = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";
  const res = await fetch(`https://graph.facebook.com/${graph}/${args.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: args.to, type: "text", text: { body: args.text.slice(0, 4000), preview_url: false } }),
  });
  if (!res.ok) throw new Error(`WhatsApp send failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
