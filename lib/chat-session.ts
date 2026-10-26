import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

export type PendingOrder = { reference: string; total_kobo: number; expires_at: string | null; status: string; pay_on_delivery: boolean; pod_offered: boolean };

/** Resolve a public chat visitor to their conversation; both ids must match. */
export async function findConversation(slug: string, conversationId?: string | null, visitorToken?: string | null) {
  if (!conversationId || !visitorToken) return null;
  const db = supabaseAdmin();
  const { data: ws } = await db.from("workspaces").select("id,name,status").eq("slug", slug).maybeSingle();
  if (!ws || ws.status !== "active") return null;
  const { data: conv } = await db.from("conversations").select("id,workspace_id").eq("id", conversationId).eq("visitor_token", visitorToken).eq("workspace_id", ws.id).maybeSingle();
  return conv ? { ws, conv } : null;
}

/** The newest order in this chat that still needs the customer or the team to act. */
export async function pendingOrder(conversationId: string): Promise<PendingOrder | null> {
  const db = supabaseAdmin();
  const { data } = await db.from("orders").select("workspace_id,reference,total_kobo,expires_at,status,pay_on_delivery")
    .eq("conversation_id", conversationId)
    .in("status", ["awaiting_payment", "verification_pending", "payment_rejected", "payment_confirmed"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const { data: st } = await db.from("business_payment_settings").select("pay_on_delivery_enabled").eq("workspace_id", data.workspace_id).maybeSingle();
  const { workspace_id: _ws, ...o } = data;
  return { ...o, pod_offered: Boolean(st?.pay_on_delivery_enabled) };
}
