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

/** How the assistant should describe a live promotion, in one line. */
export function describePromo(p: Promo): string {
  const amount = p.kind === "percent" ? `${p.value}% off` : `₦${(p.value / 100).toLocaleString("en-NG")} off`;
  const scope = p.item_ids?.length ? " selected items" : " the order";
  const min = p.min_order_kobo ? ` on orders from ₦${(p.min_order_kobo / 100).toLocaleString("en-NG")}` : "";
  const until = p.ends_at ? `, until ${new Date(p.ends_at).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}` : "";
  return `${p.title}: ${amount}${scope}${min}${until} (code ${p.code})`;
}
