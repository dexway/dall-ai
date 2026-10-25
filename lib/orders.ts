import "server-only";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { buildQuote, orderReference, QuoteError, type CatalogueRow } from "@/lib/money";
import { serverEnv } from "@/lib/env";

export type CheckoutInput = {
  workspaceId: string;
  workspaceName: string;
  conversationId: string | null;
  maxDiscountPct: number;
  items: { item_id: string; quantity: number }[];
  discountPct?: number;
  customer: { name?: string; phone?: string; email?: string };
};

/** Creates (or returns the existing) order for this exact basket. Totals are computed here, never by the model. */
export async function createCheckout(input: CheckoutInput) {
  const db = supabaseAdmin();
  const ids = input.items.map((i) => i.item_id);
  const { data: rows, error } = await db.from("catalogue_items")
    .select("id,name,price_kobo,intro_price_kobo,stock,active").eq("workspace_id", input.workspaceId).in("id", ids);
  if (error) throw error;
  const quote = buildQuote(input.items, (rows ?? []) as CatalogueRow[], {
    discount_pct: input.discountPct ?? 0, max_discount_pct: input.maxDiscountPct,
  });

  const basket = JSON.stringify([...quote.lines].sort((a, b) => a.item_id.localeCompare(b.item_id)).map((l) => [l.item_id, l.quantity]));
  const idem = createHash("sha256").update(`${input.conversationId ?? "direct"}|${basket}|${quote.discount_kobo}`).digest("hex").slice(0, 40);

  const existing = await db.from("orders").select("id,reference,public_token,total_kobo,status")
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

  const { data: settings } = await db.from("business_payment_settings").select("payment_deadline_hours").eq("workspace_id", input.workspaceId).single();
  const expires = new Date(Date.now() + (settings?.payment_deadline_hours ?? 24) * 3600_000).toISOString();

  for (let attempt = 0; attempt < 3; attempt++) {
    const reference = orderReference(input.workspaceName);
    const { data: order, error: oErr } = await db.from("orders").insert({
      workspace_id: input.workspaceId, reference, customer_id: customerId, conversation_id: input.conversationId,
      status: "awaiting_payment", subtotal_kobo: quote.subtotal_kobo, discount_kobo: quote.discount_kobo,
      total_kobo: quote.total_kobo, currency: quote.currency, expires_at: expires, idempotency_key: idem,
    }).select("id,reference,public_token,total_kobo,status").single();
    if (oErr?.code === "23505" && oErr.message.includes("idempotency")) {
      const again = await db.from("orders").select("id,reference,public_token,total_kobo,status").eq("workspace_id", input.workspaceId).eq("idempotency_key", idem).single();
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
      details: { total_kobo: quote.total_kobo, discount_kobo: quote.discount_kobo, by: "agent" },
    });
    return { order, quote, reused: false };
  }
  throw new QuoteError("Could not create an order reference, please retry");
}

export function checkoutUrl(publicToken: string) {
  return `${serverEnv.siteUrl()}/pay/${publicToken}`;
}
