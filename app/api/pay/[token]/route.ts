import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { loadCheckout } from "@/lib/checkout";
import { decryptSecret } from "@/lib/crypto";
import { initializeTransaction } from "@/lib/paystack";
import { extractReceipt, receiptFlags } from "@/lib/ai/receipt";
import { GatewayError } from "@/lib/ai/gateway";
import { serverEnv } from "@/lib/env";

// Customer-facing checkout actions. The order token in the URL is the only credential.
const MAX_FILE = 5 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = await loadCheckout(token);
  if (!c) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  const db = supabaseAdmin();
  const { order } = c;
  const payable = ["awaiting_payment", "payment_rejected", "payment_failed"].includes(order.status);

  const ct = req.headers.get("content-type") ?? "";

  // 1) Customer approves the itemised order before any payment
  if (ct.includes("application/json")) {
    const body = z.object({ action: z.enum(["approve", "paystack"]), email: z.string().email().optional() }).safeParse(await req.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });

    if (body.data.action === "approve") {
      if (!payable) return NextResponse.json({ error: "This order can no longer be changed." }, { status: 409 });
      if (!order.customer_approved_at) {
        await db.from("orders").update({ customer_approved_at: new Date().toISOString() }).eq("id", order.id).is("customer_approved_at", null);
        await db.from("financial_audit_logs").insert({ workspace_id: order.workspace_id, action: "order.customer_approved", entity: "order", entity_id: order.reference });
      }
      return NextResponse.json({ ok: true });
    }

    // 2) Paystack: hosted checkout on the business's own Paystack account
    if (!order.customer_approved_at) return NextResponse.json({ error: "Approve the order first." }, { status: 409 });
    if (!payable) return NextResponse.json({ error: "This order is not awaiting payment." }, { status: 409 });
    if (!c.paystackReady || !body.data.email) return NextResponse.json({ error: "Card payment is not available for this business." }, { status: 400 });
    const { data: sec } = await db.from("business_payment_secrets").select("paystack_secret_enc").eq("workspace_id", order.workspace_id).single();
    const attempt = Date.now().toString(36).toUpperCase();
    const reference = `${order.reference}-${attempt}`;
    try {
      const init = await initializeTransaction(decryptSecret(sec!.paystack_secret_enc), {
        email: body.data.email, amount_kobo: order.total_kobo, reference,
        callback_url: `${serverEnv.siteUrl()}/pay/${token}?paid=1`,
        metadata: { order_id: order.id, workspace_id: order.workspace_id, kind: "commerce" },
      });
      await db.from("payments").insert({ workspace_id: order.workspace_id, order_id: order.id, method: "paystack", provider_reference: reference, amount_kobo: order.total_kobo, currency: order.currency, status: "pending" });
      return NextResponse.json({ url: init.authorization_url });
    } catch (e) {
      console.error("[pay] paystack init failed", (e as Error).message);
      return NextResponse.json({ error: "Card payment could not start. Try bank transfer or try again." }, { status: 502 });
    }
  }

  // 3) Bank transfer receipt upload
  if (ct.includes("multipart/form-data")) {
    if (!order.customer_approved_at) return NextResponse.json({ error: "Approve the order first." }, { status: 409 });
    if (!payable) return NextResponse.json({ error: "This order is not awaiting payment." }, { status: 409 });
    if (c.evidence.filter((e) => e.status === "pending").length >= 3) return NextResponse.json({ error: "Your receipts are already being checked." }, { status: 429 });
    const form = await req.formData();
    const file = form.get("receipt");
    if (!(file instanceof File)) return NextResponse.json({ error: "Attach your transfer receipt." }, { status: 400 });
    if (file.size > MAX_FILE) return NextResponse.json({ error: "File is larger than 5 MB." }, { status: 413 });
    if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: "Upload a PNG, JPG, WEBP or PDF." }, { status: 415 });

    const buf = Buffer.from(await file.arrayBuffer());
    const ext = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1];
    const path = `${order.workspace_id}/${order.id}/${crypto.randomUUID()}.${ext}`;
    const up = await db.storage.from("payment-evidence").upload(path, buf, { contentType: file.type });
    if (up.error) return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });

    // Preliminary reading only. A person approves; a screenshot never marks an order paid.
    let extracted = null, flags: string[] = ["needs_manual_review"];
    try {
      const fields = await extractReceipt({ workspaceId: order.workspace_id, mediaType: file.type, base64: buf.toString("base64") });
      extracted = fields;
      flags = receiptFlags(fields, { amount_kobo: order.total_kobo, account_number: c.bank?.account_number, account_name: c.bank?.account_name, reference: order.reference, created_at: order.created_at });
    } catch (e) {
      if (!(e instanceof GatewayError)) console.error("[pay] receipt read failed", (e as Error).message);
      flags = ["not_auto_read"];
    }
    await db.from("payment_evidence").insert({ workspace_id: order.workspace_id, order_id: order.id, file_path: path, extracted, flags });
    await db.from("orders").update({ status: "verification_pending" }).eq("id", order.id);
    await db.from("financial_audit_logs").insert({ workspace_id: order.workspace_id, action: "evidence.submitted", entity: "order", entity_id: order.reference, details: { flags } });
    return NextResponse.json({ ok: true, status: "verification_pending" });
  }

  return NextResponse.json({ error: "Unsupported request." }, { status: 415 });
}
