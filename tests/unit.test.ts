import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { buildQuote, formatNaira, nairaToKobo, orderReference, QuoteError } from "../lib/money.ts";
import { creditsFor, reservationFor, usdCost, limitMessage, limitCodeFrom } from "../lib/credits.ts";
import { receiptFlags } from "../lib/receipt-flags.ts";
import { signatureValid, paymentMatches } from "../lib/paystack.ts";

const cat = [
  { id: "a", name: "Jollof tray", price_kobo: 3_500_000, intro_price_kobo: null, stock: null, active: true },
  { id: "b", name: "Small chops", price_kobo: 1_000_000, intro_price_kobo: 800_000, stock: 2, active: true },
  { id: "c", name: "Old menu", price_kobo: 100, intro_price_kobo: null, stock: null, active: false },
];

test("quote uses catalogue prices, intro price and merges duplicate lines", () => {
  const q = buildQuote([{ item_id: "a", quantity: 2 }, { item_id: "b", quantity: 1 }, { item_id: "a", quantity: 1 }], cat);
  assert.equal(q.subtotal_kobo, 3 * 3_500_000 + 800_000);
  assert.equal(q.total_kobo, q.subtotal_kobo);
  assert.equal(q.lines.find((l) => l.item_id === "a")!.quantity, 3);
});
test("quote refuses inactive, unknown, out-of-stock and bad quantities", () => {
  assert.throws(() => buildQuote([{ item_id: "c", quantity: 1 }], cat), QuoteError);
  assert.throws(() => buildQuote([{ item_id: "zzz", quantity: 1 }], cat), QuoteError);
  assert.throws(() => buildQuote([{ item_id: "b", quantity: 3 }], cat), /Only 2/);
  assert.throws(() => buildQuote([{ item_id: "a", quantity: 0 }], cat), QuoteError);
  assert.throws(() => buildQuote([{ item_id: "a", quantity: 1.5 }], cat), QuoteError);
});
test("discounts are capped by the agent limit and rounded down in the customer's favour of the business", () => {
  assert.throws(() => buildQuote([{ item_id: "a", quantity: 1 }], cat, { discount_pct: 10, max_discount_pct: 5 }), /team member/);
  const q = buildQuote([{ item_id: "a", quantity: 1 }], cat, { discount_pct: 5, max_discount_pct: 5 });
  assert.equal(q.discount_kobo, 175_000);
  assert.equal(q.total_kobo, 3_325_000);
});
test("naira formatting and parsing", () => {
  assert.equal(formatNaira(14_000_000), "₦140,000");
  assert.equal(nairaToKobo("₦3,500.50"), 350_050);
  assert.throws(() => nairaToKobo("abc"));
  assert.match(orderReference("Mama Put"), /^MAM-[A-HJ-NP-Z2-9]{8}$/);
});

const rate = { version: "t", model: "m", input_usd_per_mtok: 3, output_usd_per_mtok: 15, cache_write_usd_per_mtok: 3.75, cache_read_usd_per_mtok: 0.3, credits_per_usd: 100 };
test("credits follow real token usage including cache, rounded up", () => {
  const u = { input_tokens: 3000, output_tokens: 300, cache_creation_input_tokens: 1000, cache_read_input_tokens: 10000 };
  assert.ok(Math.abs(usdCost(u, rate) - (0.009 + 0.0045 + 0.00375 + 0.003)) < 1e-12);
  assert.equal(creditsFor(u, rate), 2.03);
  assert.equal(creditsFor({ input_tokens: 0, output_tokens: 0 }, rate), 0);
  assert.ok(reservationFor(10_000, 1024, rate) >= creditsFor({ input_tokens: 2500, output_tokens: 1024 }, rate), "hold covers worst case");
});
test("limit codes map to clear messages", () => {
  assert.equal(limitCodeFrom({ message: "INSUFFICIENT_CREDITS" }), "INSUFFICIENT_CREDITS");
  assert.equal(limitMessage("INSUFFICIENT_CREDITS").status, 402);
  assert.equal(limitMessage("RATE_LIMITED").status, 429);
});

const order = { amount_kobo: 14_000_000, account_number: "0123454417", account_name: "Mama Put Kitchen", reference: "MAM-X", created_at: "2026-10-24T08:00:00Z" };
const good = { amount_naira: 140000, reference: "100004261024", date: "2026-10-24T08:05:00Z", sender_name: "Tunde A", recipient_name: "MAMA PUT KITCHEN", recipient_account: "******4417", bank: "GTBank", status_text: "Successful", readable: true };
test("matching receipt has no flags", () => assert.deepEqual(receiptFlags(good, order), []));
test("receipt problems are flagged", () => {
  assert.deepEqual(receiptFlags({ ...good, amount_naira: 14000 }, order), ["amount_short"]);
  assert.ok(receiptFlags({ ...good, recipient_account: "9999999999" }, order).includes("account_mismatch"));
  assert.ok(receiptFlags({ ...good, recipient_name: "Chidi Ventures" }, order).includes("name_mismatch"));
  assert.ok(receiptFlags({ ...good, status_text: "Transaction Failed" }, order).includes("status_not_successful"));
  assert.ok(receiptFlags({ ...good, date: "2026-10-01T08:00:00Z" }, order).includes("dated_before_order"));
  assert.deepEqual(receiptFlags({ ...good, readable: false }, order), ["unreadable"]);
});

test("Paystack webhook signature and payment matching", () => {
  const body = JSON.stringify({ event: "charge.success", data: { reference: "R1" } });
  const sig = createHmac("sha512", "sk_test_x").update(body).digest("hex");
  assert.equal(signatureValid("sk_test_x", body, sig), true);
  assert.equal(signatureValid("sk_test_other", body, sig), false);
  assert.equal(signatureValid("sk_test_x", body + " ", sig), false);
  assert.equal(signatureValid("sk_test_x", body, null), false);
  const v = { status: "success", reference: "R1", amount: 500, currency: "NGN", id: 1 };
  assert.equal(paymentMatches(v, { reference: "R1", amount_kobo: 500, currency: "NGN" }), true);
  assert.equal(paymentMatches({ ...v, amount: 499 }, { reference: "R1", amount_kobo: 500, currency: "NGN" }), false);
  assert.equal(paymentMatches({ ...v, status: "failed" }, { reference: "R1", amount_kobo: 500, currency: "NGN" }), false);
});
