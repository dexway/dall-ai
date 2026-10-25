import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";
import { paymentMatches, verifyTransaction } from "@/lib/paystack";
import { serverEnv } from "@/lib/env";

/**
 * Commerce: confirm a business customer's Paystack payment. Safe to call any number of times
 * (webhook retries, page refreshes): only the first call that flips 'pending' → 'confirmed' has effect.
 */
export async function confirmCommercePayment(workspaceId: string, reference: string): Promise<"confirmed" | "already" | "mismatch" | "not_found" | "unpaid"> {
  const db = supabaseAdmin();
  const { data: pay } = await db.from("payments").select("id,order_id,amount_kobo,currency,status")
    .eq("workspace_id", workspaceId).eq("provider_reference", reference).maybeSingle();
  if (!pay) return "not_found";
  if (pay.status === "confirmed") return "already";
  const { data: sec } = await db.from("business_payment_secrets").select("paystack_secret_enc").eq("workspace_id", workspaceId).single();
  if (!sec?.paystack_secret_enc) return "not_found";

  const v = await verifyTransaction(decryptSecret(sec.paystack_secret_enc), reference);
  if (v.status !== "success") {
    if (["failed", "abandoned", "reversed"].includes(v.status)) await db.from("payments").update({ status: "failed" }).eq("id", pay.id).eq("status", "pending");
    return "unpaid";
  }
  if (!paymentMatches(v, { reference, amount_kobo: pay.amount_kobo, currency: pay.currency })) {
    await db.from("financial_audit_logs").insert({ workspace_id: workspaceId, action: "payment.mismatch", entity: "payment", entity_id: reference, details: { provider_amount: v.amount, expected: pay.amount_kobo, currency: v.currency } });
    return "mismatch";
  }
  const { data: flipped } = await db.from("payments")
    .update({ status: "confirmed", verified_at: new Date().toISOString(), gateway_transaction_id: String(v.id) })
    .eq("id", pay.id).eq("status", "pending").select("id");
  if (!flipped?.length) return "already";
  await db.from("orders").update({ status: "payment_confirmed" }).eq("id", pay.order_id);
  await db.from("financial_audit_logs").insert({ workspace_id: workspaceId, action: "payment.confirmed", entity: "payment", entity_id: reference, details: { amount_kobo: v.amount, gateway_id: v.id } });
  return "confirmed";
}

/** Platform: credit a workspace for a verified top-up. Credits are granted once per reference. */
export async function confirmTopUp(reference: string): Promise<"granted" | "already" | "mismatch" | "not_found" | "unpaid"> {
  const db = supabaseAdmin();
  const { data: top } = await db.from("credit_top_up_orders").select("*").eq("reference", reference).maybeSingle();
  if (!top) return "not_found";
  if (top.status === "paid") return "already";
  const v = await verifyTransaction(serverEnv.platformPaystackSecret(), reference);
  if (v.status !== "success") return "unpaid";
  if (!paymentMatches(v, { reference, amount_kobo: Number(top.amount_kobo), currency: "NGN" })) return "mismatch";

  await db.from("platform_payment_transactions").upsert({
    workspace_id: top.workspace_id, top_up_id: top.id, provider_reference: reference, amount_kobo: v.amount, status: "success", verified_at: new Date().toISOString(),
  }, { onConflict: "provider_reference", ignoreDuplicates: true });
  const { data: granted } = await db.rpc("grant_credits", {
    ws: top.workspace_id, amount: Number(top.credits), p_kind: "topup", p_key: `topup:${reference}`, p_note: `Top-up ${reference}`, p_actor: top.created_by,
  });
  await db.from("credit_top_up_orders").update({ status: "paid" }).eq("id", top.id);
  if (granted && top.plan_id) {
    // Plan purchase: activate (or renew) for 30 days from now or from the current paid period end, whichever is later.
    const { data: sub } = await db.from("platform_subscriptions").select("status,current_period_end").eq("workspace_id", top.workspace_id).single();
    const base = sub?.status === "active" && new Date(sub.current_period_end) > new Date() ? new Date(sub.current_period_end) : new Date();
    await db.from("platform_subscriptions").update({
      plan_id: top.plan_id, status: "active", current_period_start: new Date().toISOString(),
      current_period_end: new Date(base.getTime() + 30 * 86400_000).toISOString(),
    }).eq("workspace_id", top.workspace_id);
    await db.from("billing_audit_logs").insert({ workspace_id: top.workspace_id, actor_id: top.created_by, action: "subscription.activated", details: { plan: top.plan_id, reference } });
  }
  return granted ? "granted" : "already";
}
