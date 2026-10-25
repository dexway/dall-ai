// Pure parser for Messenger ("page") and Instagram DM webhooks. No server-only import, so tests can load it.

export type MetaInbound = {
  channel: "facebook" | "instagram";
  accountId: string;   // our Page id (Messenger) or Instagram professional account id
  senderId: string;    // the customer's id on that channel (PSID or IGSID)
  messageId: string;   // platform message id, used to skip retries
  text: string;        // empty for photos, stickers, etc.
};

/** Flattens a page or instagram webhook payload. Our own echoed replies are dropped. */
export function parseMetaWebhook(body: unknown): MetaInbound[] {
  const b = body as { object?: string; entry?: { id?: string; time?: number; messaging?: MetaMessaging[] }[] } | null;
  const channel = b?.object === "instagram" ? "instagram" : b?.object === "page" ? "facebook" : null;
  if (!channel) return [];
  const out: MetaInbound[] = [];
  for (const entry of b?.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      if (m.message?.is_echo) continue;
      const senderId = m.sender?.id;
      if (!senderId) continue;
      const accountId = m.recipient?.id ?? entry.id ?? "";
      if (!accountId) continue;
      out.push({
        channel, accountId, senderId,
        messageId: m.message?.mid ?? `${accountId}:${m.timestamp ?? entry.time ?? 0}:${senderId}`,
        text: m.message?.text ?? "",
      });
    }
  }
  return out;
}

type MetaMessaging = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean };
};
