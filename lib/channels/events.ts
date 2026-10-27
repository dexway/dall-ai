// Common internal event format for WhatsApp, Messenger and Instagram webhooks.
// Pure (no server-only imports) so the unit tests can load it.

export type Provider = "whatsapp" | "facebook" | "instagram";

export type Attachment = { type: string; id?: string; url?: string; mime?: string; caption?: string };

/** What Meta tells us about the ad or link that started a chat. Never guessed. */
export type Referral = { source: string; adId?: string; ctwaClid?: string; headline?: string; ref?: string; sourceUrl?: string };

export type MessageEvent = {
  kind: "message"; provider: Provider; accountId: string; contactId: string; contactName?: string;
  messageId: string; timestamp: number; text: string; attachments: Attachment[]; referral?: Referral;
};
/** Delivery receipt for a message we sent (WhatsApp statuses, Messenger delivery). */
export type StatusEvent = {
  kind: "status"; provider: Provider; accountId: string; contactId?: string;
  providerMessageId: string; status: "sent" | "delivered" | "read" | "failed"; timestamp: number; error?: string;
};
/** Messenger/Instagram read receipt: everything we sent before `watermark` was read. */
export type ReadEvent = { kind: "read"; provider: Provider; accountId: string; contactId: string; watermark: number };
/** Customer opened the chat from an ad or m.me link without typing yet (Messenger OPEN_THREAD). */
export type ReferralEvent = { kind: "referral"; provider: Provider; accountId: string; contactId: string; timestamp: number; referral: Referral };

export type ChannelEvent = MessageEvent | StatusEvent | ReadEvent | ReferralEvent;

/** Stable idempotency key per provider: the same delivery retried by Meta gets the same key. */
export function eventKey(e: ChannelEvent): string {
  switch (e.kind) {
    case "message": return `msg:${e.messageId}`;
    case "status": return `st:${e.providerMessageId}:${e.status}`;
    case "read": return `read:${e.accountId}:${e.contactId}:${e.watermark}`;
    case "referral": return `ref:${e.accountId}:${e.contactId}:${e.timestamp}`;
  }
}

/** The account (phone number id, Page id, Instagram id) an event belongs to, for finding the business. */
export const accountOf = (e: ChannelEvent) => e.accountId;

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

// ---------------- WhatsApp Cloud API ----------------

type WaMessage = {
  id: string; from: string; timestamp?: string; type: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; caption?: string; filename?: string };
  audio?: { id?: string; mime_type?: string }; video?: { id?: string; mime_type?: string; caption?: string };
  sticker?: { id?: string; mime_type?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  referral?: { source_url?: string; source_id?: string; source_type?: string; headline?: string; ctwa_clid?: string };
};
type WaStatus = { id: string; status: string; timestamp?: string; recipient_id?: string; errors?: { code?: number; title?: string; message?: string }[] };

export function parseWhatsAppEvents(body: unknown): ChannelEvent[] {
  const out: ChannelEvent[] = [];
  const entries = (body as { entry?: unknown[] } | null)?.entry ?? [];
  for (const e of entries as { changes?: { value?: Record<string, unknown> }[] }[]) {
    for (const c of e.changes ?? []) {
      const v = c.value as { metadata?: { phone_number_id?: string }; contacts?: { wa_id: string; profile?: { name?: string } }[]; messages?: WaMessage[]; statuses?: WaStatus[] } | undefined;
      const accountId = v?.metadata?.phone_number_id;
      if (!accountId) continue;
      const names = new Map((v?.contacts ?? []).map((k) => [k.wa_id, k.profile?.name]));
      for (const m of v?.messages ?? []) {
        const attachments: Attachment[] = [];
        for (const t of ["image", "document", "audio", "video", "sticker"] as const) {
          const a = m[t];
          if (a) attachments.push({ type: t, id: a.id, mime: a.mime_type, caption: (a as { caption?: string }).caption });
        }
        if (m.location) attachments.push({ type: "location", caption: [m.location.name, m.location.address, `${m.location.latitude},${m.location.longitude}`].filter(Boolean).join(" · ") });
        const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title
          ?? attachments.find((a) => a.caption)?.caption ?? "";
        const r = m.referral;
        out.push({
          kind: "message", provider: "whatsapp", accountId, contactId: m.from, contactName: names.get(m.from) ?? undefined,
          messageId: m.id, timestamp: num(m.timestamp) * 1000, text, attachments,
          referral: r ? { source: r.source_type ?? "unknown", adId: r.source_type === "ad" ? r.source_id : undefined, ctwaClid: r.ctwa_clid, headline: r.headline, sourceUrl: r.source_url } : undefined,
        });
      }
      for (const s of v?.statuses ?? []) {
        if (!["sent", "delivered", "read", "failed"].includes(s.status)) continue;
        const err = s.errors?.[0];
        out.push({
          kind: "status", provider: "whatsapp", accountId, contactId: s.recipient_id, providerMessageId: s.id,
          status: s.status as StatusEvent["status"], timestamp: num(s.timestamp) * 1000,
          error: err ? `${err.code ?? ""} ${err.title ?? err.message ?? ""}`.trim() : undefined,
        });
      }
    }
  }
  return out;
}

// ---------------- Messenger ("page") and Instagram ("instagram") ----------------

type MetaRef = { ref?: string; ad_id?: string; source?: string; type?: string; ads_context_data?: { ad_title?: string } };
type MetaMessaging = {
  sender?: { id?: string }; recipient?: { id?: string }; timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; quick_reply?: { payload?: string }; attachments?: { type?: string; payload?: { url?: string } }[]; referral?: MetaRef };
  postback?: { mid?: string; title?: string; payload?: string; referral?: MetaRef };
  referral?: MetaRef;
  delivery?: { mids?: string[]; watermark?: number };
  read?: { watermark?: number; mid?: string };
};

const metaRef = (r?: MetaRef): Referral | undefined => r ? {
  source: r.source === "ADS" || r.ad_id ? "ad" : (r.source ?? "link").toLowerCase(),
  adId: r.ad_id, ref: r.ref, headline: r.ads_context_data?.ad_title,
} : undefined;

export function parseMetaEvents(body: unknown): ChannelEvent[] {
  const b = body as { object?: string; entry?: { id?: string; time?: number; messaging?: MetaMessaging[] }[] } | null;
  const provider: Provider | null = b?.object === "instagram" ? "instagram" : b?.object === "page" ? "facebook" : null;
  if (!provider) return [];
  const out: ChannelEvent[] = [];
  for (const entry of b?.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      if (m.message?.is_echo) continue;
      const contactId = m.sender?.id;
      const accountId = m.recipient?.id ?? entry.id ?? "";
      if (!contactId || !accountId) continue;
      const ts = m.timestamp ?? entry.time ?? 0;
      if (m.message || m.postback) {
        const attachments: Attachment[] = (m.message?.attachments ?? []).map((a) => ({ type: a.type ?? "file", url: a.payload?.url }));
        out.push({
          kind: "message", provider, accountId, contactId,
          messageId: m.message?.mid ?? m.postback?.mid ?? `${accountId}:${ts}:${contactId}`,
          timestamp: ts, text: m.message?.text ?? m.postback?.title ?? "", attachments,
          referral: metaRef(m.message?.referral ?? m.postback?.referral),
        });
      } else if (m.referral) {
        out.push({ kind: "referral", provider, accountId, contactId, timestamp: ts, referral: metaRef(m.referral)! });
      } else if (m.delivery?.mids?.length) {
        for (const mid of m.delivery.mids) out.push({ kind: "status", provider, accountId, contactId, providerMessageId: mid, status: "delivered", timestamp: ts });
      } else if (m.read?.watermark) {
        out.push({ kind: "read", provider, accountId, contactId, watermark: m.read.watermark });
      }
    }
  }
  return out;
}

// ---------------- Messaging windows ----------------

export type WindowDecision = { ok: true; tag?: "HUMAN_AGENT" } | { ok: false; reason: string; needsTemplate?: boolean };

const H = 3600_000;

/**
 * Meta's free-form reply windows: 24 hours after the customer's last message on every channel.
 * Messenger and Instagram allow a human (not the AI) to reply up to 7 days with the HUMAN_AGENT tag.
 * WhatsApp outside 24 hours needs an approved template.
 */
export function replyWindow(provider: Provider | "web", lastInboundAt: string | Date | null | undefined, by: "agent" | "human", now = Date.now()): WindowDecision {
  if (provider === "web") return { ok: true };
  if (!lastInboundAt) return { ok: false, reason: "The customer hasn't messaged yet, so you can't start the chat here.", needsTemplate: provider === "whatsapp" };
  const age = now - new Date(lastInboundAt).getTime();
  if (age <= 24 * H) return { ok: true };
  if (provider === "whatsapp") return { ok: false, reason: "More than 24 hours since the customer's last message. WhatsApp only allows an approved template message now.", needsTemplate: true };
  if (by === "human" && age <= 7 * 24 * H) return { ok: true, tag: "HUMAN_AGENT" };
  return { ok: false, reason: by === "agent" ? "More than 24 hours since the customer's last message, so the assistant can't reply." : "More than 7 days since the customer's last message. Meta doesn't allow replies until they message again." };
}

/** Text the AI sees for a message with no words (photo, voice note, location...). */
export function describeForAgent(e: Pick<MessageEvent, "text" | "attachments">): string {
  if (e.text) return e.text;
  const a = e.attachments[0];
  if (!a) return "";
  const what: Record<string, string> = { image: "a photo", video: "a video", audio: "a voice note", document: "a document", sticker: "a sticker", location: "their location", file: "a file" };
  return `[The customer sent ${what[a.type] ?? "an attachment"}${a.caption ? `: ${a.caption}` : ""}. You can't see it. If it looks like a payment receipt, say the team will check it; otherwise ask them to describe what they need in text.]`;
}
