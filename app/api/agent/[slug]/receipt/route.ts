import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { findConversation, pendingOrder } from "@/lib/chat-session";
import { submitEvidence, EvidenceError } from "@/lib/evidence";
import { formatNaira } from "@/lib/money";
import { clientIp, withinLimits } from "@/lib/rate-limit";

// In-chat 📎 upload: the customer sends their transfer screenshot for the order in this chat.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Each receipt is read by AI: cap uploads per IP.
  if (!(await withinLimits([{ key: `receipt-ip:${clientIp(req)}`, limit: 10, windowSeconds: 3_600 }]))) {
    return NextResponse.json({ error: "Too many uploads. Please wait a little and try again." }, { status: 429 });
  }
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Send the screenshot as a file." }, { status: 400 });
  const found = await findConversation(slug, String(form.get("conversationId") ?? ""), String(form.get("visitorToken") ?? ""));
  if (!found) return NextResponse.json({ error: "Start a chat first, then send your receipt." }, { status: 404 });
  const file = form.get("receipt");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Attach your transfer screenshot." }, { status: 400 });

  const db = supabaseAdmin();
  const { data: order } = await db.from("orders")
    .select("id,workspace_id,reference,total_kobo,early_total_kobo,created_at,status,expires_at,customer_approved_at")
    .eq("conversation_id", found.conv.id).in("status", ["awaiting_payment", "payment_rejected", "payment_failed"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!order) return NextResponse.json({ error: "There's no order waiting for payment in this chat. Ask the assistant to set one up first." }, { status: 409 });

  try {
    await submitEvidence(order, file);
  } catch (e) {
    if (e instanceof EvidenceError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const reply = `Thank you! I've received your receipt for order ${order.reference} (${formatNaira(order.total_kobo)}). ${found.ws.name} is verifying it in their bank account now. I'll confirm here once it's approved. You can ask me "has my payment been confirmed?" anytime.`;
  await db.from("messages").insert([
    { conversation_id: found.conv.id, workspace_id: found.ws.id, role: "user", content: { text: `[sent a transfer receipt for ${order.reference}]` } },
    { conversation_id: found.conv.id, workspace_id: found.ws.id, role: "assistant", content: { text: reply } },
  ]);
  return NextResponse.json({ reply, pending: await pendingOrder(found.conv.id) });
}
