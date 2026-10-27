import { NextResponse } from "next/server";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase/server";
import { runAgentTurn } from "@/lib/ai/agent";
import { GatewayError } from "@/lib/ai/gateway";
import { AI } from "@/lib/config";
import { findConversation, pendingOrder } from "@/lib/chat-session";
import { profileText, type BusinessProfile } from "@/lib/business-profile";
import { clientIp, withinLimits, CHAT_LIMITS } from "@/lib/rate-limit";

// Public web-widget endpoint. Anyone can chat; every reply is metered to the business that owns the agent.
const Body = z.object({
  message: z.string().trim().min(1).max(AI.maxUserMessageChars),
  conversationId: z.string().uuid().optional(),
  visitorToken: z.string().uuid().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Message is empty or too long." }, { status: 400 });
  const { message } = parsed.data;
  // Anyone can reach this endpoint and every message costs an AI call: cap it per IP, chat and business.
  if (!(await withinLimits(CHAT_LIMITS(clientIp(req), slug, parsed.data.conversationId)))) {
    return NextResponse.json({ error: "You're sending messages too quickly. Please wait a minute and try again." }, { status: 429 });
  }
  const db = supabaseAdmin();

  const { data: ws } = await db.from("workspaces").select("id,name,status,business_profile").eq("slug", slug).maybeSingle();
  if (!ws || ws.status !== "active") return NextResponse.json({ error: "This assistant is not available." }, { status: 404 });
  const { data: agent } = await db.from("agents").select("id,workspace_id,name,role_title,persona,languages,greeting,max_discount_pct,instructions,knowledge")
    .eq("workspace_id", ws.id).eq("active", true).order("created_at").limit(1).maybeSingle();
  if (!agent) return NextResponse.json({ error: "This assistant is not available." }, { status: 404 });

  // Resume only a conversation this visitor owns
  let conversation: { id: string; visitor_token: string; ai_paused?: boolean } | null = null;
  if (parsed.data.conversationId && parsed.data.visitorToken) {
    const { data } = await db.from("conversations").select("id,visitor_token,ai_paused")
      .eq("id", parsed.data.conversationId).eq("agent_id", agent.id).eq("visitor_token", parsed.data.visitorToken).maybeSingle();
    conversation = data;
  }
  if (!conversation) {
    const { data, error } = await db.from("conversations").insert({ workspace_id: ws.id, agent_id: agent.id, channel: "web" })
      .select("id,visitor_token,ai_paused").single();
    if (error) return NextResponse.json({ error: "Could not start a chat." }, { status: 500 });
    conversation = data;
  }

  const { data: past } = await db.from("messages").select("role,content").eq("conversation_id", conversation.id)
    .order("created_at", { ascending: false }).limit(AI.maxHistoryMessages);
  const history: Anthropic.MessageParam[] = (past ?? []).reverse()
    .map((m) => ({ role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant", content: String(m.content.text ?? "") }))
    .filter((m) => m.content);

  await db.from("messages").insert({ conversation_id: conversation.id, workspace_id: ws.id, role: "user", content: { text: message } });
  const now = new Date().toISOString();
  await db.from("conversations").update({ last_message_at: now, last_inbound_at: now, unread: true }).eq("id", conversation.id);

  // A team member took over this chat: store the message for them and don't let the AI answer.
  if (conversation.ai_paused) {
    return NextResponse.json({ reply: null, handedOver: true, conversationId: conversation.id, visitorToken: conversation.visitor_token, pending: await pendingOrder(conversation.id) });
  }

  try {
    const reply = await runAgentTurn({ agent, businessName: ws.name, conversationId: conversation.id, history, userText: message, profile: profileText(ws.business_profile as BusinessProfile) });
    await db.from("messages").insert({ conversation_id: conversation.id, workspace_id: ws.id, role: "assistant", content: { text: reply }, delivery_status: "delivered" });
    await db.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conversation.id);
    return NextResponse.json({ reply, conversationId: conversation.id, visitorToken: conversation.visitor_token, pending: await pendingOrder(conversation.id) });
  } catch (e) {
    if (e instanceof GatewayError) {
      // Customers see a polite message; the business owner sees the real reason in the dashboard.
      const customerText = e.status === 402 || e.status === 403
        ? "Sorry, this assistant is resting right now. Please contact the business directly."
        : e.message;
      return NextResponse.json({ error: customerText, code: e.code, conversationId: conversation.id, visitorToken: conversation.visitor_token }, { status: e.status });
    }
    console.error("[chat] unexpected", (e as Error).message);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

// Refresh the timer / payment status for a returning visitor.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const u = new URL(req.url);
  const found = await findConversation(slug, u.searchParams.get("c"), u.searchParams.get("v"));
  if (!found) return NextResponse.json({ pending: null });
  // Team replies typed in the inbox since the visitor's last check.
  const after = u.searchParams.get("after");
  let team: { text: string; at: string }[] = [];
  if (after && !Number.isNaN(Date.parse(after))) {
    const { data } = await supabaseAdmin().from("messages").select("content,created_at").eq("conversation_id", found.conv.id)
      .eq("role", "human").gt("created_at", new Date(after).toISOString()).order("created_at").limit(20);
    team = (data ?? []).map((m) => ({ text: String((m.content as { text?: string }).text ?? ""), at: m.created_at }));
  }
  return NextResponse.json({ pending: await pendingOrder(found.conv.id), team });
}
