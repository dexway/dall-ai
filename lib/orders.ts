import "server-only";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { buildQuote, orderReference, QuoteError, type CatalogueRow } from "@/lib/money";
import { serverEnv } from "@/lib/env";
import { earlyPayAmount } from "@/lib/early-pay";
import { applyPromo, type Promo } from "@/lib/promo";

export type CheckoutInput = {
  workspaceId: string;
  workspaceName: string;
  conversationId: string | null;
  maxDiscountPct: number;
  items: { item_id: string; quantity: number }[];
  discountPct?: number;
  promoCode?: string;
  customer: { name?: string; phone?: string; email?: string };
};

/** Creates (or returns the existing) order for this exact basket. Totals are computed here, never by the model. */
export async function createCheckout(input: CheckoutInput) {
  const db = supabaseAdmin();
  const ids = input.items.map((i) => i.item_id);
  const { data: rows, error } = await db.from("catalogue_items")
    .select("id,name,price_kobo,intro_price_kobo,stock,active").eq("workspace_id", input.workspaceId).in("id", ids);
  if (error) throw error;
  let quote = buildQuote(input.items, (rows ?? []) as CatalogueRow[], {
    discount_pct: input.promoCode ? 0 : input.discountPct ?? 0, max_discount_pct: input.maxDiscountPct,
  });
  // A promotion replaces the assistant's own discount. The server checks it and does the maths.
  let promo: Promo | null = null;
  if (input.promoCode) {
    const { data: p } = await db.from("promotions").select("*").eq("workspace_id", input.workspaceId).eq("code", input.promoCode.trim().toUpperCase()).maybeSingle();
    if (!p) throw new QuoteError("That promo code isn't valid for this business.");
    promo = p as Promo;
    quote = applyPromo(quote, promo);
  }

  const basket = JSON.stringify([...quote.lines].sort((a, b) => a.item_id.localeCompare(b.item_id)).map((l) => [l.item_id, l.quantity]));
  const idem = createHash("sha256").update(`${input.conversationId ?? "direct"}|${basket}|${quote.discount_kobo}|${promo?.code ?? ""}`).digest("hex").slice(0, 40);

  const existing = await db.from("orders").select("id,reference,public_token,total_kobo,early_total_kobo,status,expires_at,promo_code")
    .eq("workspace_id", input.workspaceId).eq("idempotency_key", idem).maybeSingle();
  if (existing.data) return { order: existing.data, quote, reused: true };

  let customerId: string | null = null;
  if (input.customer.phone || input.customer.email || input.customer.name) {
    const { data: c } = await db.from("customers").insert({
      workspace_id: input.workspaceId, name: input.customer.name ?? null,
      phone: input.customer.phone ?? null, email: input.customer.email ?? null,
    }).select("id").single();
    customerId = c?.id ?? null;
  }

  const { data: settings } = await db.from("business_payment_settings").select("payment_deadline_hours,payment_window_minutes,early_pay_bonus_pct").eq("workspace_id", input.workspaceId).single();
  // Early-payment bonus: only for chat orders (the timer is shown there), and only paid by transfer inside the countdown.
  const earlyTotal = input.conversationId && (settings?.early_pay_bonus_pct ?? 0) > 0
    ? earlyPayAmount(quote.total_kobo, settings!.early_pay_bonus_pct) : null;
  // Orders made in chat use the short transfer window (timer shown in the chat); others use the hours deadline.
  const windowMs = input.conversationId ? (settings?.payment_window_minutes ?? 60) * 60_000 : (settings?.payment_deadline_hours ?? 24) * 3600_000;
  const expires = new Date(Date.now() + windowMs).toISOString();

  // Claim one use of a limited promotion atomically, only for a brand-new order.
  if (promo) {
    const { data: claimed } = await db.rpc("claim_promo_use", { p_promo: promo.id });
    if (!claimed) throw new QuoteError("That promotion has just been fully used or has ended.");
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const reference = orderReference(input.workspaceName);
    const { data: order, error: oErr } = await db.from("orders").insert({
      workspace_id: input.workspaceId, reference, customer_id: customerId, conversation_id: input.conversationId,
      status: "awaiting_payment", subtotal_kobo: quote.subtotal_kobo, discount_kobo: quote.discount_kobo,
      total_kobo: quote.total_kobo, early_total_kobo: earlyTotal, currency: quote.currency, expires_at: expires, idempotency_key: idem,
      promo_code: promo?.code ?? null,
    }).select("id,reference,public_token,total_kobo,early_total_kobo,status,expires_at,promo_code").single();
    if (oErr?.code === "23505" && oErr.message.includes("idempotency")) {
      const again = await db.from("orders").select("id,reference,public_token,total_kobo,early_total_kobo,status,expires_at,promo_code").eq("workspace_id", input.workspaceId).eq("idempotency_key", idem).single();
      return { order: again.data!, quote, reused: true };
    }
    if (oErr?.code === "23505") continue; // reference collision, try another
    if (oErr) throw oErr;
    await db.from("order_items").insert(quote.lines.map((l) => ({
      order_id: order.id, workspace_id: input.workspaceId, catalogue_item_id: l.item_id, name: l.name,
      unit_price_kobo: l.unit_price_kobo, quantity: l.quantity, line_total_kobo: l.line_total_kobo,
    })));
    await db.from("financial_audit_logs").insert({
      workspace_id: input.workspaceId, action: "order.created", entity: "order", entity_id: order.reference,
      details: { total_kobo: quote.total_kobo, discount_kobo: quote.discount_kobo, promo: promo?.code ?? null, by: "agent" },
    });
    return { order, quote, reused: false };
  }
  throw new QuoteError("Could not create an order reference, please retry");
}

export function checkoutUrl(publicToken: string) {
  return `${serverEnv.siteUrl()}/pay/${publicToken}`;
}
