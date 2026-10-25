// Pure money helpers. Amounts are integer kobo everywhere; never floats.

export type CatalogueRow = {
  id: string;
  name: string;
  price_kobo: number;
  intro_price_kobo: number | null;
  stock: number | null;
  active: boolean;
};

export type QuoteLine = { item_id: string; name: string; unit_price_kobo: number; quantity: number; line_total_kobo: number };
export type Quote = { lines: QuoteLine[]; subtotal_kobo: number; discount_kobo: number; total_kobo: number; currency: "NGN" };

export class QuoteError extends Error {}

export function formatNaira(kobo: number): string {
  const naira = kobo / 100;
  return "₦" + naira.toLocaleString("en-NG", { minimumFractionDigits: naira % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

export function nairaToKobo(input: string | number): number {
  const n = typeof input === "number" ? input : Number(String(input).replace(/[₦,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new QuoteError("Enter a valid amount in naira");
  return Math.round(n * 100);
}

/**
 * Build a quote from requested items using only the business's own catalogue.
 * The model never supplies prices: it only names item ids and quantities.
 * Discounts are capped at the agent's configured limit; anything above needs a person.
 */
export function buildQuote(
  requested: { item_id: string; quantity: number }[],
  catalogue: CatalogueRow[],
  opts: { discount_pct?: number; max_discount_pct?: number } = {},
): Quote {
  if (!requested.length) throw new QuoteError("No items requested");
  const byId = new Map(catalogue.map((c) => [c.id, c]));
  const merged = new Map<string, number>();
  for (const r of requested) {
    if (!Number.isInteger(r.quantity) || r.quantity < 1 || r.quantity > 999) throw new QuoteError(`Invalid quantity for ${r.item_id}`);
    merged.set(r.item_id, (merged.get(r.item_id) ?? 0) + r.quantity);
  }
  const lines: QuoteLine[] = [];
  for (const [id, quantity] of merged) {
    const item = byId.get(id);
    if (!item || !item.active) throw new QuoteError(`Item ${id} is not available`);
    if (item.stock !== null && item.stock < quantity) throw new QuoteError(`Only ${item.stock} of ${item.name} left`);
    const unit = item.intro_price_kobo ?? item.price_kobo;
    lines.push({ item_id: id, name: item.name, unit_price_kobo: unit, quantity, line_total_kobo: unit * quantity });
  }
  const subtotal = lines.reduce((s, l) => s + l.line_total_kobo, 0);
  const pct = opts.discount_pct ?? 0;
  const cap = opts.max_discount_pct ?? 0;
  if (pct < 0) throw new QuoteError("Discount cannot be negative");
  if (pct > cap) throw new QuoteError(`Discount of ${pct}% is above the ${cap}% this assistant may give; a team member must approve it`);
  const discount = Math.floor((subtotal * pct) / 100);
  return { lines, subtotal_kobo: subtotal, discount_kobo: discount, total_kobo: subtotal - discount, currency: "NGN" };
}

export function orderReference(prefix: string, random: () => number = Math.random): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion when read over the phone
  let s = "";
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(random() * alphabet.length)];
  return `${prefix.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "DAL"}-${s}`;
}
