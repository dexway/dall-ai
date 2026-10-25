import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { runAgentTurn } from "@/lib/ai/agent";
import { GatewayError } from "@/lib/ai/gateway";
import { AI } from "@/lib/config";
import { decryptSecret } from "@/lib/crypto";
import { sendText, type Inbound } from "@/lib/channels/whatsapp-parse";

const UNSUPPORTED = "I can read text messages for now. Please type your question, and I will help you.";
const RESTING = "Sorry, this assistant is resting right now. Please contact the business directly.";

/** Handles one inbound WhatsApp message: find the business, run the agent, reply on the same number. */
export async function handleWhatsAppInbound(msg: Inbound): Promise<void> {
  const db = supabaseAdmin();

  const { data: conn } = await db.from("channel_connections").select("id,workspace_id,access_token_enc")
    .eq("provider", "whatsapp").eq("external_id", msg.phoneNumberId).eq("status", "active").maybeSingle();
  if (!conn) return; // number not connected to any business

  // Meta retries deliveries; a message we already stored is skipped.
  const { data: dup } = await db.from("messages").select("id")
    .eq("workspace_id", conn.workspace_id).eq("external_id", msg.messageId).maybeSingle();
  if (dup) return;

  const { data: ws } = await db.from("workspaces").select("id,name,status").eq("id", conn.workspace_id).maybeSingle();
  if (!ws || ws.status !== "active") return;
  const token = decryptSecret(conn.access_token_enc);
  const reply = (text: string) => sendText({ accessToken: token, phoneNumberId: msg.phoneNumberId, to: msg.from, text });

  if (!msg.text) { await reply(UNSUPPORTED); return; }

  const { data: agent } = await db.from("agents").select("id,workspace_id,name,role_title,persona,languages,greeting,max_discount_pct")
    .eq("workspace_id", ws.id).eq("active", true).order("created_at").limit(1).maybeSingle();
  if (!agent) return;

  // One conversation per customer phone number on this channel.
  let { data: conversation } = await db.from("conversations").select("id,visitor_token")
    .eq("workspace_id", ws.id).eq("channel", "whatsapp").eq("external_ref", msg.from).maybeSingle();
  if (!conversation) {
    const { data, error } = await db.from("conversations")
      .insert({ workspace_id: ws.id, agent_id: agent.id, channel: "whatsapp", external_ref: msg.from })
      .select("id,visitor_token").single();
    if (error) throw new Error(`conversation insert failed: ${error.message}`);
    conversation = data;
  }

  const { data: past } = await db.from("messages").select("role,content").eq("conversation_id", conversation.id)
    .order("created_at", { ascending: false }).limit(AI.maxHistoryMessages);
  const history = (past ?? []).reverse().map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content.text ?? "") }));

  await db.from("messages").insert({
    conversation_id: conversation.id, workspace_id: ws.id, role: "user", content: { text: msg.text }, external_id: msg.messageId,
  });

  let text: string;
  try {
    text = await runAgentTurn({ agent, businessName: ws.name, conversationId: conversation.id, history, userText: msg.text });
  } catch (e) {
    if (e instanceof GatewayError) text = e.status === 402 || e.status === 403 ? RESTING : e.message;
    else throw e;
  }
  await db.from("messages").insert({ conversation_id: conversation.id, workspace_id: ws.id, role: "assistant", content: { text } });
  await reply(text);
}
