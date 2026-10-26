import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";
import { sendText, type Inbound } from "@/lib/channels/whatsapp-parse";
import { handleAgentMessage } from "@/lib/channels/agent-message";
import { flagIfAuthFailure } from "@/lib/channels/health";

const UNSUPPORTED = "I can read text messages for now. Please type your question, and I will help you.";

/** Handles one inbound WhatsApp message: find the business, then run the shared agent handler. */
export async function handleWhatsAppInbound(msg: Inbound): Promise<void> {
  const { data: conn } = await supabaseAdmin().from("channel_connections").select("workspace_id,access_token_enc")
    .eq("provider", "whatsapp").eq("external_id", msg.phoneNumberId).eq("status", "active").maybeSingle();
  if (!conn) return; // number not connected to any business

  const token = decryptSecret(conn.access_token_enc);
  const reply = async (text: string) => {
    try { await sendText({ accessToken: token, phoneNumberId: msg.phoneNumberId, to: msg.from, text }); }
    catch (e) { await flagIfAuthFailure("whatsapp", msg.phoneNumberId, e); throw e; }
  };

  if (!msg.text) { await reply(UNSUPPORTED); return; }
  await handleAgentMessage({
    workspaceId: conn.workspace_id, channel: "whatsapp", externalRef: msg.from,
    messageId: msg.messageId, text: msg.text, reply,
  });
}
