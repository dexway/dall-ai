// Paystack adapter. Used by both money systems with DIFFERENT keys:
//   commerce  → the business's own secret key (money settles to the business)
//   platform  → PLATFORM_PAYSTACK_SECRET_KEY (credit top-ups paid to Dall AI)
import { createHmac, timingSafeEqual } from "node:crypto";

const BASE = "https://api.paystack.co";

export type PaystackVerify = {
  status: string; // "success" | "failed" | "abandoned" | ...
  reference: string;
  amount: number; // kobo
  currency: string;
  id: number;
};

export async function initializeTransaction(secret: string, input: {
  email: string; amount_kobo: number; reference: string; callback_url: string; metadata?: Record<string, unknown>;
}): Promise<{ authorization_url: string; reference: string }> {
  const res = await fetch(`${BASE}/transaction/initialize`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: input.email, amount: input.amount_kobo, currency: "NGN",
      reference: input.reference, callback_url: input.callback_url, metadata: input.metadata,
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.status) throw new Error(`Paystack initialize failed: ${body.message ?? res.status}`);
  return { authorization_url: body.data.authorization_url, reference: body.data.reference };
}

/** Server-side source of truth: never trust a redirect or a webhook body alone. */
export async function verifyTransaction(secret: string, reference: string): Promise<PaystackVerify> {
  const res = await fetch(`${BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` },
    cache: "no-store",
  });
  const body = await res.json();
  if (!res.ok || !body.status) throw new Error(`Paystack verify failed: ${body.message ?? res.status}`);
  const d = body.data;
  return { status: d.status, reference: d.reference, amount: d.amount, currency: d.currency, id: d.id };
}

/** Paystack signs webhooks with HMAC-SHA512 of the raw body using the account's secret key. */
export function signatureValid(secret: string, rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** All four must match before money is treated as received. */
export function paymentMatches(v: PaystackVerify, expected: { reference: string; amount_kobo: number; currency: string }) {
  return v.status === "success" && v.reference === expected.reference && v.amount === expected.amount_kobo && v.currency === expected.currency;
}
