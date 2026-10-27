import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

const money = (minor: number, cur: string) => `${cur === "NGN" ? "₦" : `${cur} `}${(minor / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;

/**
 * Per-campaign funnel. Spend and Meta's conversation count come from synced insights; chats,
 * leads and paid orders come only from conversations whose ad_id Meta reported. No estimates.
 */
export async function adFunnel(workspaceId: string, sinceDays = 30) {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString();
  const [{ data: camps }, { data: accounts }, { data: daily }, { data: convs }, { count: unattr }] = await Promise.all([
    db.from("ad_campaigns").select("id,name,product_label,ad_account_id,meta_ad_id,status").eq("workspace_id", workspaceId).neq("status", "failed").order("created_at", { ascending: false }).limit(50),
    db.from("ad_connections").select("ad_account_id,currency").eq("workspace_id", workspaceId),
    db.from("ad_insights_daily").select("ad_campaign_id,spend_minor,conversations_started,leads").eq("workspace_id", workspaceId),
    db.from("conversations").select("id,ad_id").eq("workspace_id", workspaceId).not("ad_id", "is", null),
    db.from("conversations").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).is("ad_id", null).gte("created_at", since),
  ]);
  const cur = new Map((accounts ?? []).map((a) => [a.ad_account_id, a.currency ?? "NGN"]));
  const convIdsByAd = new Map<string, string[]>();
  for (const c of convs ?? []) convIdsByAd.set(c.ad_id!, [...(convIdsByAd.get(c.ad_id!) ?? []), c.id]);
  const allConvIds = (convs ?? []).map((c) => c.id);
  const [{ data: leads }, { data: orders }] = allConvIds.length ? await Promise.all([
    db.from("leads").select("conversation_id").in("conversation_id", allConvIds),
    db.from("orders").select("conversation_id").in("conversation_id", allConvIds).in("status", ["payment_confirmed", "order_fulfilled"]),
  ]) : [{ data: [] as { conversation_id: string }[] }, { data: [] as { conversation_id: string }[] }];

  const rows = (camps ?? []).map((c) => {
    const d = (daily ?? []).filter((x) => x.ad_campaign_id === c.id);
    const ids = new Set(c.meta_ad_id ? convIdsByAd.get(c.meta_ad_id) ?? [] : []);
    const metaConv = d.reduce((s, x) => s + Number(x.conversations_started), 0);
    return {
      id: c.id, name: c.name ?? c.product_label ?? "Campaign",
      spend: money(d.reduce((s, x) => s + Number(x.spend_minor), 0), cur.get(c.ad_account_id) ?? "NGN"),
      metaConversations: d.length ? metaConv : null,
      conversations: ids.size,
      leads: (leads ?? []).filter((l) => ids.has(l.conversation_id)).length,
      paidOrders: new Set((orders ?? []).filter((o) => ids.has(o.conversation_id!)).map((o) => o.conversation_id)).size,
    };
  });
  return { rows, unattributed: unattr ?? 0 };
}
