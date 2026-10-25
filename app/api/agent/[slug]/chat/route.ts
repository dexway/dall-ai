import { NextResponse } from "next/server";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase/server";
import { runAgentTurn } from "@/lib/ai/agent";
import { GatewayError } from "@/lib/ai/gateway";
import { AI } from "@/lib/config";

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
  const db = supabaseAdmin();

  const { data: ws } = await db.from("workspaces").select("id,name,status").eq("slug", slug).maybeSingle();
  if (!ws || ws.status !== "active") return NextResponse.json({ error: "This assistant is not available." }, { status: 404 });
  const { data: agent } = await db.from("agents").select("id,workspace_id,name,role_title,persona,languages,greeting,max_discount_pct")
    .eq("workspace_id", ws.id).eq("active", true).order("created_at").limit(1).maybeSingle();
  if (!agent) return NextResponse.json({ error: "This assistant is not available." }, { status: 404 });

  // Resume only a conversation this visitor owns
  let conversation: { id: string; visitor_token: string } | null = null;
  if (parsed.data.conversationId && parsed.data.visitorToken) {
    const { data } = await db.from("conversations").select("id,visitor_token")
      .eq("id", parsed.data.conversationId).eq("agent_id", agent.id).eq("visitor_token", parsed.data.visitorToken).maybeSingle();
    conversation = data;
  }
  if (!conversation) {
    const { data, error } = await db.from("conversations").insert({ workspace_id: ws.id, agent_id: agent.id, channel: "web" })
      .select("id,visitor_token").single();
    if (error) return NextResponse.json({ error: "Could not start a chat." }, { status: 500 });
    conversation = data;
  }

  const { data: past } = await db.from("messages").select("role,content").eq("conversation_id", conversation.id)
    .order("created_at", { ascending: false }).limit(AI.maxHistoryMessages);
  const history: Anthropic.MessageParam[] = (past ?? []).reverse().map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content.text ?? "") }));

  await db.from("messages").insert({ conversation_id: conversation.id, workspace_id: ws.id, role: "user", content: { text: message } });

  try {
    const reply = await runAgentTurn({ agent, businessName: ws.name, conversationId: conversation.id, history, userText: message });
    await db.from("messages").insert({ conversation_id: conversation.id, workspace_id: ws.id, role: "assistant", content: { text: reply } });
    return NextResponse.json({ reply, conversationId: conversation.id, visitorToken: conversation.visitor_token });
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
