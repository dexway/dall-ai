import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

/** Everything the public checkout page may show, looked up by the unguessable order token. */
export async function loadCheckout(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const db = supabaseAdmin();
  const { data: order } = await db.from("orders")
    .select("id,workspace_id,reference,status,subtotal_kobo,discount_kobo,total_kobo,currency,customer_approved_at,expires_at,created_at")
    .eq("public_token", token).maybeSingle();
  if (!order) return null;
  const [{ data: items }, { data: ws }, { data: settings }, { data: secret }, { data: evidence }] = await Promise.all([
    db.from("order_items").select("name,unit_price_kobo,quantity,line_total_kobo").eq("order_id", order.id),
    db.from("workspaces").select("name,slug").eq("id", order.workspace_id).single(),
    db.from("business_payment_settings").select("bank_name,account_name,account_number,transfer_instructions,paystack_enabled").eq("workspace_id", order.workspace_id).single(),
    db.from("business_payment_secrets").select("paystack_secret_enc").eq("workspace_id", order.workspace_id).maybeSingle(),
    db.from("payment_evidence").select("id,status,flags,created_at").eq("order_id", order.id).order("created_at", { ascending: false }),
  ]);
  const expired = order.expires_at && new Date(order.expires_at) < new Date() && order.status === "awaiting_payment";
  return {
    order: { ...order, status: expired ? "payment_expired" : order.status },
    items: items ?? [],
    business: ws!,
    bank: settings?.account_number ? settings : null,
    paystackReady: Boolean(settings?.paystack_enabled && secret?.paystack_secret_enc),
    evidence: evidence ?? [],
  };
}
