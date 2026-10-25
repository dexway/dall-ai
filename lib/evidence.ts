import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { extractReceipt, receiptFlags } from "@/lib/ai/receipt";
import { GatewayError } from "@/lib/ai/gateway";
import { acceptableAmounts } from "@/lib/early-pay";

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPT_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

export class EvidenceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type OrderRow = { id: string; workspace_id: string; reference: string; total_kobo: number; early_total_kobo: number | null; created_at: string; status: string; expires_at: string | null; customer_approved_at: string | null };

/**
 * Stores a transfer receipt, reads it (guide only), flags mismatches and queues it for a person.
 * Shared by the checkout page and the in-chat 📎 upload. Never marks an order paid.
 */
export async function submitEvidence(order: OrderRow, file: File): Promise<{ flags: string[] }> {
  if (file.size > RECEIPT_MAX_BYTES) throw new EvidenceError(413, "That file is larger than 5 MB. Send a smaller screenshot.");
  if (!RECEIPT_TYPES.includes(file.type)) throw new EvidenceError(415, "Send the receipt as a PNG, JPG, WEBP or PDF.");
  const payable = ["awaiting_payment", "payment_rejected", "payment_failed"].includes(order.status);
  if (!payable) throw new EvidenceError(409, "This order isn't waiting for payment.");

  const db = supabaseAdmin();
  const { count } = await db.from("payment_evidence").select("*", { count: "exact", head: true }).eq("order_id", order.id).eq("status", "pending");
  if ((count ?? 0) >= 3) throw new EvidenceError(429, "Your receipts are already being checked.");
  const { data: bank } = await db.from("business_payment_settings").select("account_number,account_name").eq("workspace_id", order.workspace_id).single();

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1];
  const path = `${order.workspace_id}/${order.id}/${crypto.randomUUID()}.${ext}`;
  const up = await db.storage.from("payment-evidence").upload(path, buf, { contentType: file.type });
  if (up.error) throw new EvidenceError(500, "Upload failed. Please try again.");

  let extracted = null, flags: string[] = ["needs_manual_review"];
  try {
    const fields = await extractReceipt({ workspaceId: order.workspace_id, mediaType: file.type, base64: buf.toString("base64") });
    extracted = fields;
    // Judge the receipt against whichever amount it best matches: the full total, or the early-payment amount while the timer runs.
    const options = acceptableAmounts(order, new Date()).map((amount_kobo) => receiptFlags(fields, {
      amount_kobo, account_number: bank?.account_number, account_name: bank?.account_name, reference: order.reference, created_at: order.created_at,
    }));
    flags = options.sort((a, b) => a.length - b.length)[0];
  } catch (e) {
    if (!(e instanceof GatewayError)) console.error("[evidence] receipt read failed", (e as Error).message);
    flags = ["not_auto_read"];
  }
  if (order.expires_at && new Date(order.expires_at) < new Date()) flags.push("sent_after_deadline");

  await db.from("payment_evidence").insert({ workspace_id: order.workspace_id, order_id: order.id, file_path: path, extracted, flags });
  // Paying by transfer means the customer accepted the order they were quoted.
  await db.from("orders").update({ status: "verification_pending", customer_approved_at: order.customer_approved_at ?? new Date().toISOString() }).eq("id", order.id);
  await db.from("financial_audit_logs").insert({ workspace_id: order.workspace_id, action: "evidence.submitted", entity: "order", entity_id: order.reference, details: { flags } });
  return { flags };
}
