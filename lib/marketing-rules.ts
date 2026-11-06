// Pure rules for automatic follow-ups and broadcast audiences (testable without a database).

const MIN = 60_000, HOUR = 3_600_000;
export const META_CHANNELS = ["whatsapp", "facebook", "instagram"] as const;

export type UnpaidOrder = { created_at: string; expires_at: string | null; status: string; pay_on_delivery: boolean };
export type ChatState = { channel: string; last_inbound_at: string | null; last_message_at: string | null; ai_paused: boolean; opted_out_at: string | null; outcome: string };

/** An unpaid chat checkout gets one reminder after `nudgeMinutes`, only while it can still be paid. */
export function unpaidNudgeDue(o: UnpaidOrder, chat: ChatState, nudgeMinutes: number, now = Date.now()): boolean {
  if (o.status !== "awaiting_payment" || o.pay_on_delivery) return false;
  if (!(META_CHANNELS as readonly string[]).includes(chat.channel) || chat.ai_paused) return false;
  if (now - Date.parse(o.created_at) < nudgeMinutes * MIN) return false;
  if (o.expires_at && Date.parse(o.expires_at) - now < 2 * MIN) return false;      // too late to be useful
  return withinWindow(chat.last_inbound_at, now);
}

/**
 * A chat that went quiet after the assistant's reply gets one friendly nudge, `quietHours` after the
 * customer's last message and always inside Meta's 24-hour window. Never after an opt-out, a human
 * takeover, or a finished/lost/spam chat.
 */
export function quietLeadDue(chat: ChatState, lastRole: string | null, quietHours: number, now = Date.now()): boolean {
  if (!(META_CHANNELS as readonly string[]).includes(chat.channel) || chat.ai_paused || chat.opted_out_at) return false;
  if (!["open", "qualified"].includes(chat.outcome) || lastRole !== "assistant" || !chat.last_inbound_at) return false;
  const age = now - Date.parse(chat.last_inbound_at);
  return age >= quietHours * HOUR && age < 23.5 * HOUR;
}

export function withinWindow(lastInboundAt: string | null, now = Date.now()): boolean {
  return Boolean(lastInboundAt) && now - Date.parse(lastInboundAt!) < 23.5 * HOUR;
}

export type AudienceRow = { channel: string; marketing_consent: boolean; opted_out_at: string | null; last_inbound_at: string | null };

/**
 * Who a broadcast may reach. Everyone must have said yes and not opted out. WhatsApp reaches them
 * with an approved template at any time; Messenger and Instagram only allow free text inside the
 * 24-hour window, so others are skipped (not spammed).
 */
export function broadcastEligibility(r: AudienceRow, channel: string, now = Date.now()): "send" | "skip_window" | "skip_consent" {
  if (r.channel !== channel) return "skip_consent";
  if (!r.marketing_consent || r.opted_out_at) return "skip_consent";
  if (channel !== "whatsapp" && !withinWindow(r.last_inbound_at, now)) return "skip_window";
  return "send";
}

/** How long the team can go quiet in a chat they took over before the assistant answers again. */
export const AI_RESUME_AFTER_HOURS = 2;
export const TEAM_TAKEOVER = "Taken over by the team";

/**
 * A team reply pauses the assistant so it doesn't talk over them. If they then go quiet for
 * AI_RESUME_AFTER_HOURS the assistant answers again, so a customer is never left unanswered.
 * A handoff the customer asked for ("I want a person") stays with the team until they hand it back.
 */
export function aiShouldResume(chat: { ai_paused: boolean; handoff_reason: string | null }, lastTeamReplyAt: string | null, now = Date.now()): boolean {
  if (!chat.ai_paused || !lastTeamReplyAt) return false;
  if (chat.handoff_reason && chat.handoff_reason !== TEAM_TAKEOVER) return false;
  return now - Date.parse(lastTeamReplyAt) >= AI_RESUME_AFTER_HOURS * HOUR;
}
