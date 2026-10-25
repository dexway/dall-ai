import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";
import { signatureValid } from "@/lib/paystack";
import { confirmCommercePayment } from "@/lib/payments";

// Commerce webhook. Each business sets this URL in ITS OWN Paystack dashboard:
//   https://<your-domain>/api/webhooks/paystack/<workspace-id>
export async function POST(req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return new NextResponse(null, { status: 404 });
  const raw = await req.text();
  const db = supabaseAdmin();
  const { data: sec } = await db.from("business_payment_secrets").select("paystack_secret_enc").eq("workspace_id", workspaceId).maybeSingle();
  if (!sec?.paystack_secret_enc) return new NextResponse(null, { status: 404 });
  if (!signatureValid(decryptSecret(sec.paystack_secret_enc), raw, req.headers.get("x-paystack-signature"))) {
    return new NextResponse(null, { status: 401 });
  }

  const event = JSON.parse(raw);
  const key = `${event.event}:${event.data?.id ?? ""}:${event.data?.reference ?? ""}`;
  const { error: dup } = await db.from("payment_events").insert({ workspace_id: workspaceId, provider: "paystack", event_key: key, payload: event });
  if (dup?.code === "23505") return NextResponse.json({ ok: true, duplicate: true });

  if (event.event === "charge.success" && event.data?.reference) {
    try {
      const result = await confirmCommercePayment(workspaceId, event.data.reference);
      return NextResponse.json({ ok: true, result });
    } catch (e) {
      console.error("[webhook] commerce verify failed", (e as Error).message);
      await db.from("payment_events").delete().eq("event_key", key); // let Paystack retry
      return new NextResponse(null, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true });
}
