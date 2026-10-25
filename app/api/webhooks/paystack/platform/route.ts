import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { signatureValid } from "@/lib/paystack";
import { confirmTopUp } from "@/lib/payments";
import { serverEnv } from "@/lib/env";

// Platform billing webhook (Dall AI's own Paystack account). Set in Dall AI's Paystack dashboard:
//   https://<your-domain>/api/webhooks/paystack/platform
export async function POST(req: Request) {
  const secret = serverEnv.platformPaystackSecret();
  if (!secret) return new NextResponse(null, { status: 503 });
  const raw = await req.text();
  if (!signatureValid(secret, raw, req.headers.get("x-paystack-signature"))) return new NextResponse(null, { status: 401 });

  const event = JSON.parse(raw);
  const key = `${event.event}:${event.data?.id ?? ""}:${event.data?.reference ?? ""}`;
  const db = supabaseAdmin();
  const { error: dup } = await db.from("billing_webhook_events").insert({ event_key: key, payload: event });
  if (dup?.code === "23505") return NextResponse.json({ ok: true, duplicate: true });

  if (event.event === "charge.success" && event.data?.metadata?.kind === "topup") {
    try {
      return NextResponse.json({ ok: true, result: await confirmTopUp(event.data.reference) });
    } catch (e) {
      console.error("[webhook] top-up verify failed", (e as Error).message);
      await db.from("billing_webhook_events").delete().eq("event_key", key);
      return new NextResponse(null, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true });
}
