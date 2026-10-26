import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { findConversation, pendingOrder } from "@/lib/chat-session";

// Customer chose "pay on delivery" after the transfer timer ran out. Only allowed when the
// business turned it on, and only for this visitor's own unpaid, timed-out order.
const Body = z.object({ conversationId: z.string().uuid(), visitorToken: z.string().uuid() });

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const found = await findConversation(slug, parsed.data.conversationId, parsed.data.visitorToken);
  if (!found) return NextResponse.json({ error: "Chat not found." }, { status: 404 });
  const db = supabaseAdmin();
  const { data: st } = await db.from("business_payment_settings").select("pay_on_delivery_enabled").eq("workspace_id", found.ws.id).maybeSingle();
  if (!st?.pay_on_delivery_enabled) return NextResponse.json({ error: "Pay on delivery isn't offered by this business." }, { status: 403 });
  const { data: order } = await db.from("orders").select("id,reference,status,expires_at,pay_on_delivery")
    .eq("conversation_id", found.conv.id).in("status", ["awaiting_payment", "payment_rejected"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!order) return NextResponse.json({ error: "No unpaid order in this chat." }, { status: 404 });
  if (!order.pay_on_delivery) {
    if (order.expires_at && new Date(order.expires_at) > new Date()) return NextResponse.json({ error: "Your payment time hasn't run out yet." }, { status: 409 });
    await db.from("orders").update({ pay_on_delivery: true, status: "awaiting_payment", expires_at: null }).eq("id", order.id);
    await db.from("financial_audit_logs").insert({ workspace_id: found.ws.id, action: "order.pay_on_delivery", entity: "order", entity_id: order.reference, details: { by: "customer" } });
  }
  const reply = `Done ✓ Order ${order.reference} is now pay on delivery. ${found.ws.name} will contact you to arrange delivery, and you pay when it arrives.`;
  await db.from("messages").insert({ conversation_id: found.conv.id, workspace_id: found.ws.id, role: "assistant", content: { text: reply } });
  return NextResponse.json({ reply, pending: await pendingOrder(found.conv.id) });
}
