// Pure promotion maths. The model only names a code; the server checks it and computes the discount.
import { QuoteError, type Quote } from "./money.ts";

export type Promo = {
  id: string; code: string; title: string; kind: "percent" | "fixed"; value: number;
  min_order_kobo: number; max_discount_kobo: number | null; item_ids: string[] | null;
  starts_at: string; ends_at: string | null; max_uses: number | null; uses: number; active: boolean;
};

/** Why a promotion can't be used right now, or null if it can (before looking at the basket). */
export function promoUnavailable(p: Promo, now = new Date()): string | null {
  if (!p.active) return "That promotion has ended.";
  if (new Date(p.starts_at) > now) return "That promotion hasn't started yet.";
  if (p.ends_at && new Date(p.ends_at) <= now) return "That promotion has ended.";
  if (p.max_uses !== null && p.uses >= p.max_uses) return "That promotion has been fully used.";
  return null;
}

/**
 * Applies a promotion to a quote. Promotions replace (never stack with) the assistant's own discount.
 * Only lines for the promotion's items count when it's limited to some items.
 */
export function applyPromo(quote: Quote, p: Promo, now = new Date()): Quote {
  const why = promoUnavailable(p, now);
  if (why) throw new QuoteError(why);
  if (quote.subtotal_kobo < p.min_order_kobo) throw new QuoteError(`That promotion needs an order of at least ₦${(p.min_order_kobo / 100).toLocaleString("en-NG")}.`);
  const eligible = p.item_ids?.length ? quote.lines.filter((l) => p.item_ids!.includes(l.item_id)).reduce((s, l) => s + l.line_total_kobo, 0) : quote.subtotal_kobo;
  if (eligible <= 0) throw new QuoteError("That promotion doesn't cover the items in this order.");
  let off = p.kind === "percent" ? Math.floor((eligible * p.value) / 100) : Math.min(p.value, eligible);
  if (p.max_discount_kobo !== null) off = Math.min(off, p.max_discount_kobo);
  return { ...quote, discount_kobo: off, total_kobo: quote.subtotal_kobo - off };
}

/** The offer in a few words, e.g. "10% off" or "₦2,000 off". */
export function promoOffer(p: Pick<Promo, "kind" | "value">): string {
  return p.kind === "percent" ? `${p.value}% off` : `₦${(p.value / 100).toLocaleString("en-NG")} off`;
}

/** Values for a WhatsApp deal template, in order: {{1}} title, {{2}} offer, {{3}} code, {{4}} end date. */
export function dealTemplateParams(p: Pick<Promo, "title" | "kind" | "value" | "code" | "ends_at">, vars: number): string[] {
  const until = p.ends_at ? `until ${new Date(p.ends_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", timeZone: "Africa/Lagos" })}` : "while it lasts";
  return [p.title, promoOffer(p), p.code, until].slice(0, Math.max(0, Math.min(4, vars)));
}

/** How the assistant should describe a live promotion, in one line. */
export function describePromo(p: Promo): string {
  const amount = promoOffer(p);
  const scope = p.item_ids?.length ? " selected items" : " the order";
  const min = p.min_order_kobo ? ` on orders from ₦${(p.min_order_kobo / 100).toLocaleString("en-NG")}` : "";
  const until = p.ends_at ? `, until ${new Date(p.ends_at).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}` : "";
  return `${p.title}: ${amount}${scope}${min}${until} (code ${p.code})`;
}
