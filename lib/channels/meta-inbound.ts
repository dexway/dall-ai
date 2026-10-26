import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";
import { sendMetaText } from "@/lib/meta";
import { handleAgentMessage } from "@/lib/channels/agent-message";
import { flagIfAuthFailure } from "@/lib/channels/health";
import type { MetaInbound } from "@/lib/channels/meta-parse";

const UNSUPPORTED = "I can read text messages for now. Please type your question, and I will help you.";

/** Handles one Messenger or Instagram DM: find the business that owns this Page or account, then run the agent. */
export async function handleMetaInbound(msg: MetaInbound): Promise<void> {
  const { data: conn } = await supabaseAdmin().from("channel_connections").select("workspace_id,access_token_enc")
    .eq("provider", msg.channel).eq("external_id", msg.accountId).eq("status", "active").maybeSingle();
  if (!conn) return; // this Page or account is not connected to any business

  const token = decryptSecret(conn.access_token_enc);
  const reply = async (text: string) => {
    try { await sendMetaText({ pageToken: token, recipientId: msg.senderId, text }); }
    catch (e) { await flagIfAuthFailure(msg.channel, msg.accountId, e); throw e; }
  };

  if (!msg.text) { await reply(UNSUPPORTED); return; }
  await handleAgentMessage({
    workspaceId: conn.workspace_id, channel: msg.channel, externalRef: msg.senderId,
    messageId: msg.messageId, text: msg.text, reply,
  });
}
