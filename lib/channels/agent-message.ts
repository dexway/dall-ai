import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { runAgentTurn } from "@/lib/ai/agent";
import { GatewayError } from "@/lib/ai/gateway";
import { AI } from "@/lib/config";
import { profileText, type BusinessProfile } from "@/lib/business-profile";

export type Channel = "whatsapp" | "facebook" | "instagram";
const RESTING = "Sorry, this assistant is resting right now. Please contact the business directly.";

/**
 * One inbound customer message on any channel: find or start that customer's chat, run the business's agent,
 * store both sides, and send the reply through the channel's own `reply` function.
 */
export async function handleAgentMessage(args: {
  workspaceId: string; channel: Channel; externalRef: string; messageId: string; text: string;
  reply: (text: string) => Promise<void>;
}): Promise<void> {
  const db = supabaseAdmin();

  // Meta and WhatsApp retry deliveries: a message already stored is skipped.
  const { data: dup } = await db.from("messages").select("id")
    .eq("workspace_id", args.workspaceId).eq("external_id", args.messageId).maybeSingle();
  if (dup) return;

  const { data: ws } = await db.from("workspaces").select("id,name,status,business_profile").eq("id", args.workspaceId).maybeSingle();
  if (!ws || ws.status !== "active") return;
  const { data: agent } = await db.from("agents").select("id,workspace_id,name,role_title,persona,languages,greeting,max_discount_pct,instructions,knowledge")
    .eq("workspace_id", ws.id).eq("active", true).order("created_at").limit(1).maybeSingle();
  if (!agent) return;

  // One conversation per customer per channel.
  let { data: conversation } = await db.from("conversations").select("id,visitor_token")
    .eq("workspace_id", ws.id).eq("channel", args.channel).eq("external_ref", args.externalRef).maybeSingle();
  if (!conversation) {
    const { data, error } = await db.from("conversations")
      .insert({ workspace_id: ws.id, agent_id: agent.id, channel: args.channel, external_ref: args.externalRef })
      .select("id,visitor_token").single();
    if (error) throw new Error(`conversation insert failed: ${error.message}`);
    conversation = data;
  }

  const { data: past } = await db.from("messages").select("role,content").eq("conversation_id", conversation.id)
    .order("created_at", { ascending: false }).limit(AI.maxHistoryMessages);
  const history = (past ?? []).reverse().map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content.text ?? "") }));

  await db.from("messages").insert({
    conversation_id: conversation.id, workspace_id: ws.id, role: "user", content: { text: args.text }, external_id: args.messageId,
  });

  let text: string;
  try {
    text = await runAgentTurn({
      agent, businessName: ws.name, conversationId: conversation.id, history, userText: args.text,
      profile: profileText(ws.business_profile as BusinessProfile),
    });
  } catch (e) {
    if (e instanceof GatewayError) text = e.status === 402 || e.status === 403 ? RESTING : e.message;
    else throw e;
  }
  await db.from("messages").insert({ conversation_id: conversation.id, workspace_id: ws.id, role: "assistant", content: { text } });
  await args.reply(text);
}
