import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";
import { gatewayCall, GatewayError } from "@/lib/ai/gateway";
import { formatNaira } from "@/lib/money";
import { deliver, connectionFor, logIntegrationError } from "@/lib/channels/process";
import { sendTemplate } from "@/lib/channels/send";
import { unpaidNudgeDue, quietLeadDue, broadcastEligibility, META_CHANNELS } from "@/lib/marketing-rules";

type Settings = { followups_enabled: boolean; unpaid_nudge_minutes: number; quiet_lead_hours: number; upsell_enabled: boolean };
export const DEFAULT_SETTINGS: Settings = { followups_enabled: true, unpaid_nudge_minutes: 20, quiet_lead_hours: 20, upsell_enabled: true };

export async function marketingSettings(workspaceId: string): Promise<Settings> {
  const { data } = await supabaseAdmin().from("marketing_settings").select("followups_enabled,unpaid_nudge_minutes,quiet_lead_hours,upsell_enabled").eq("workspace_id", workspaceId).maybeSingle();
  return data ?? DEFAULT_SETTINGS;
}

/** Writes a short, personal nudge for a quiet chat from its last messages. Falls back to a plain line. */
async function quietNudgeText(workspaceId: string, conversationId: string, businessName: string): Promise<string> {
  const fallback = `Hi again! Just checking in from ${businessName} — any questions I can help with, or shall I put your order together?`;
  const { data: msgs } = await supabaseAdmin().from("messages").select("role,content").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(8);
  const transcript = (msgs ?? []).reverse().map((m) => `${m.role === "user" ? "Customer" : "Us"}: ${String((m.content as { text?: string }).text ?? "").slice(0, 300)}`).join("\n");
  try {
    const res = await gatewayCall({
      workspaceId, feature: "followup", conversationId, maxTokens: 120,
      system: `You write one short, warm follow-up WhatsApp-style message for ${businessName} to a customer who went quiet. Refer to what they asked about. One question that makes replying easy. No pressure, no fake urgency, no discounts unless already offered in the chat, max 2 sentences. Reply with the message only.`,
      messages: [{ role: "user", content: transcript || "(no history)" }],
    });
    const text = res.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("").trim();
    return text && text.length < 400 ? text : fallback;
  } catch (e) {
    if (!(e instanceof GatewayError)) console.error("[followup] copy failed", (e as Error).message);
    return fallback;
  }
}

/**
 * Sends due follow-ups for every business: one reminder per unpaid chat checkout, one nudge per quiet
 * chat per day. A row is written first (unique per order / chat-day), so a retry never double-sends.
 */
export async function runDueFollowups(budgetMs = 45_000): Promise<{ sent: number; skipped: number; failed: number }> {
  const db = supabaseAdmin();
  const started = Date.now();
  const tally = { sent: 0, skipped: 0, failed: 0 };
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();

  // 1. Unpaid checkouts started in chats on Meta channels.
  const { data: orders } = await db.from("orders").select("id,workspace_id,reference,total_kobo,created_at,expires_at,status,pay_on_delivery,conversation_id")
    .eq("status", "awaiting_payment").not("conversation_id", "is", null).gte("created_at", since).limit(200);
  const settingsCache = new Map<string, Settings>();
  const settingsFor = async (ws: string) => settingsCache.get(ws) ?? (settingsCache.set(ws, await marketingSettings(ws)), settingsCache.get(ws)!);

  for (const o of orders ?? []) {
    if (Date.now() - started > budgetMs) break;
    const s = await settingsFor(o.workspace_id);
    if (!s.followups_enabled) continue;
    const { data: conv } = await db.from("conversations").select("id,workspace_id,channel,external_ref,last_inbound_at,last_message_at,ai_paused,opted_out_at,outcome").eq("id", o.conversation_id!).maybeSingle();
    if (!conv || !unpaidNudgeDue(o, conv, s.unpaid_nudge_minutes)) continue;
    const mins = o.expires_at ? Math.max(1, Math.round((Date.parse(o.expires_at) - Date.now()) / 60_000)) : null;
    const text = `Quick reminder: your order ${o.reference} (${formatNaira(o.total_kobo)}) is still reserved${mins ? ` for about ${mins} more minutes` : ""}. Once you've paid, send the transfer screenshot here and we'll confirm it. Want to change anything?`;
    const { error: claimErr } = await db.from("followups").insert({ workspace_id: o.workspace_id, conversation_id: conv.id, kind: "unpaid_checkout", order_id: o.id, status: "sent", message: text });
    if (claimErr) continue; // already followed up
    const conn = await connectionFor(o.workspace_id, conv.channel);
    if (!conn || conn.status !== "active") { await db.from("followups").update({ status: "skipped", reason: "Channel off or disconnected" }).eq("order_id", o.id).eq("kind", "unpaid_checkout"); tally.skipped++; continue; }
    const r = await deliver({ conn, conv, text, role: "assistant" });
    if (!r.ok) { await db.from("followups").update({ status: "failed", reason: r.error.slice(0, 200) }).eq("order_id", o.id).eq("kind", "unpaid_checkout"); tally.failed++; }
    else tally.sent++;
  }

  // 2. Quiet chats inside the 24-hour window.
  const { data: convs } = await db.from("conversations").select("id,workspace_id,channel,external_ref,last_inbound_at,last_message_at,ai_paused,opted_out_at,outcome")
    .in("channel", [...META_CHANNELS]).eq("ai_paused", false).is("opted_out_at", null).gte("last_inbound_at", since).limit(300);
  for (const c of convs ?? []) {
    if (Date.now() - started > budgetMs) break;
    const s = await settingsFor(c.workspace_id);
    if (!s.followups_enabled) continue;
    const { data: last } = await db.from("messages").select("role").eq("conversation_id", c.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!quietLeadDue(c, last?.role ?? null, s.quiet_lead_hours)) continue;
    // Don't nudge someone with an order already paid or being checked, or nudged in the last 7 days.
    const [{ count: paid }, { count: recent }] = await Promise.all([
      db.from("orders").select("id", { count: "exact", head: true }).eq("conversation_id", c.id).in("status", ["payment_confirmed", "verification_pending", "order_fulfilled"]),
      db.from("followups").select("id", { count: "exact", head: true }).eq("conversation_id", c.id).eq("kind", "quiet_lead").gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString()),
    ]);
    if ((paid ?? 0) > 0 || (recent ?? 0) > 0) continue;
    const { data: ws } = await db.from("workspaces").select("name").eq("id", c.workspace_id).single();
    const text = await quietNudgeText(c.workspace_id, c.id, ws?.name ?? "us");
    const { data: row, error: claimErr } = await db.from("followups").insert({ workspace_id: c.workspace_id, conversation_id: c.id, kind: "quiet_lead", status: "sent", message: text }).select("id").single();
    if (claimErr || !row) continue;
    const conn = await connectionFor(c.workspace_id, c.channel);
    if (!conn || conn.status !== "active") { await db.from("followups").update({ status: "skipped", reason: "Channel off or disconnected" }).eq("id", row.id); tally.skipped++; continue; }
    const r = await deliver({ conn, conv: c, text, role: "assistant" });
    if (!r.ok) { await db.from("followups").update({ status: "failed", reason: r.error.slice(0, 200) }).eq("id", row.id); tally.failed++; }
    else tally.sent++;
  }
  return tally;
}

/** Counts who a broadcast on this channel would reach now, and why others are left out. */
export async function audienceFor(workspaceId: string, channel: string) {
  const { data } = await supabaseAdmin().from("conversations").select("id,channel,marketing_consent,opted_out_at,last_inbound_at,external_ref").eq("workspace_id", workspaceId).eq("channel", channel).limit(5000);
  const rows = data ?? [];
  const verdicts = rows.map((r) => ({ r, v: broadcastEligibility(r, channel) }));
  return {
    eligible: verdicts.filter((x) => x.v === "send").map((x) => x.r),
    outsideWindow: verdicts.filter((x) => x.v === "skip_window").length,
    noConsent: verdicts.filter((x) => x.v === "skip_consent").length,
  };
}

/** Sends a broadcast to everyone eligible. Every recipient's real result is recorded. */
export async function sendBroadcast(broadcastId: string, budgetMs = 50_000): Promise<void> {
  const db = supabaseAdmin();
  const { data: b } = await db.from("broadcasts").select("*").eq("id", broadcastId).single();
  if (!b || b.status !== "sending") return;
  const started = Date.now();
  const conn = await connectionFor(b.workspace_id, b.channel);
  if (!conn || conn.status !== "active") {
    await db.from("broadcasts").update({ status: "failed" }).eq("id", b.id);
    await logIntegrationError(b.workspace_id, "broadcast", "Broadcast not sent: the channel is off or disconnected.", { broadcast_id: b.id });
    return;
  }
  const { eligible, outsideWindow } = await audienceFor(b.workspace_id, b.channel);
  const { data: done } = await db.from("broadcast_recipients").select("conversation_id").eq("broadcast_id", b.id);
  const already = new Set((done ?? []).map((d) => d.conversation_id));
  let sent = 0, failed = 0;
  for (const c of eligible.slice(0, 1000)) {
    if (already.has(c.id)) continue;
    if (Date.now() - started > budgetMs) break;
    const { data: conv } = await db.from("conversations").select("id,workspace_id,external_ref,last_inbound_at").eq("id", c.id).single();
    if (!conv) continue;
    let status: "sent" | "failed" = "sent", error: string | null = null, pid: string | null = null;
    if (b.channel === "whatsapp") {
      try {
        pid = (await sendTemplate({ token: decryptSecret(conn.access_token_enc), phoneNumberId: conn.external_id, to: conv.external_ref!, name: b.template_name!, language: b.template_language!, params: b.template_params ?? undefined })).providerMessageId;
        await db.from("messages").insert({ conversation_id: conv.id, workspace_id: b.workspace_id, role: "assistant", content: { text: `[Broadcast: ${b.title}]` }, delivery_status: "sent", provider_message_id: pid });
      } catch (e) { status = "failed"; error = (e as Error).message.slice(0, 300); }
    } else {
      const r = await deliver({ conn, conv, text: b.message!, role: "assistant" });
      if (!r.ok) { status = "failed"; error = r.error.slice(0, 300); }
    }
    await db.from("broadcast_recipients").insert({ broadcast_id: b.id, workspace_id: b.workspace_id, conversation_id: conv.id, status, error, provider_message_id: pid });
    if (status === "sent") sent++; else failed++;
  }
  const { count: total } = await db.from("broadcast_recipients").select("*", { count: "exact", head: true }).eq("broadcast_id", b.id);
  const { count: nSent } = await db.from("broadcast_recipients").select("*", { count: "exact", head: true }).eq("broadcast_id", b.id).eq("status", "sent");
  const finished = (total ?? 0) >= Math.min(eligible.length, 1000);
  await db.from("broadcasts").update({
    sent: nSent ?? sent, failed: (total ?? 0) - (nSent ?? 0), skipped: outsideWindow, total: total ?? 0,
    ...(finished ? { status: "sent", sent_at: new Date().toISOString() } : {}),
  }).eq("id", b.id);
  void failed;
}

/** What the copilot knows about recent sales and demand, from real orders and chats only. */
export async function marketingInsights(workspaceId: string) {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [{ data: items }, { data: paidOrders }, { data: unpaid }, { data: userMsgs }] = await Promise.all([
    db.from("catalogue_items").select("id,name,price_kobo,intro_price_kobo,stock,active").eq("workspace_id", workspaceId).eq("active", true).limit(100),
    db.from("orders").select("id").eq("workspace_id", workspaceId).in("status", ["payment_confirmed", "order_fulfilled"]).gte("created_at", since),
    db.from("orders").select("total_kobo").eq("workspace_id", workspaceId).in("status", ["awaiting_payment", "payment_expired"]).gte("created_at", since),
    db.from("messages").select("content").eq("workspace_id", workspaceId).eq("role", "user").gte("created_at", since).limit(2000),
  ]);
  const ids = (paidOrders ?? []).map((o) => o.id);
  const { data: lines } = ids.length ? await db.from("order_items").select("catalogue_item_id,quantity,line_total_kobo").in("order_id", ids) : { data: [] as { catalogue_item_id: string; quantity: number; line_total_kobo: number }[] };
  const text = (userMsgs ?? []).map((m) => String((m.content as { text?: string }).text ?? "").toLowerCase());
  const rows = (items ?? []).map((i) => {
    const sold = (lines ?? []).filter((l) => l.catalogue_item_id === i.id);
    const word = i.name.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3)[0] ?? i.name.toLowerCase();
    return {
      id: i.id, name: i.name, price: i.intro_price_kobo ?? i.price_kobo, stock: i.stock,
      unitsSold: sold.reduce((s, l) => s + l.quantity, 0), revenue: sold.reduce((s, l) => s + Number(l.line_total_kobo), 0),
      mentions: text.filter((t) => t.includes(word)).length,
    };
  });
  const audience: Record<string, number> = {};
  for (const ch of META_CHANNELS) {
    const { count } = await db.from("conversations").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("channel", ch).eq("marketing_consent", true).is("opted_out_at", null);
    audience[ch] = count ?? 0;
  }
  return {
    items: rows,
    topSellers: [...rows].filter((r) => r.unitsSold > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 3),
    askedNotBought: [...rows].filter((r) => r.mentions >= 2 && r.unitsSold === 0).sort((a, b) => b.mentions - a.mentions).slice(0, 3),
    unpaidValue: (unpaid ?? []).reduce((s, o) => s + Number(o.total_kobo), 0), unpaidCount: (unpaid ?? []).length,
    audience,
  };
}

export type CopyPack = { headline: string; ad_text: string; instagram_caption: string; whatsapp_status: string; broadcast_message: string };

/** Writes ready-to-use marketing copy for one product (or the business) from real catalogue facts. */
export async function generateCopy(args: { workspaceId: string; userId: string; businessName: string; item?: { name: string; price: number; description?: string | null } | null; goal: string; promo?: string | null }): Promise<CopyPack> {
  const facts = args.item ? `Product: ${args.item.name}, price ${formatNaira(args.item.price)}${args.item.description ? `. ${args.item.description.slice(0, 300)}` : ""}` : "The whole business";
  const res = await gatewayCall({
    workspaceId: args.workspaceId, userId: args.userId, feature: "marketing_copy", maxTokens: 700,
    system: "You write short, honest marketing copy for small Nigerian businesses that sell through chat. Use only the facts given: never invent prices, stock, reviews, or discounts. Plain, specific, warm; light Pidgin is fine in WhatsApp lines. Every piece invites people to message to order. Reply with JSON only.",
    messages: [{ role: "user", content: `Business: ${args.businessName} (Lagos). ${facts}. Goal: ${args.goal}.${args.promo ? ` Live promotion: ${args.promo}.` : ""}
Return JSON with keys: headline (max 40 chars), ad_text (Facebook/Instagram click-to-chat ad, max 300 chars), instagram_caption (max 70 words, max 4 hashtags), whatsapp_status (1-2 lines), broadcast_message (for customers who opted in, max 400 chars, ends with "Reply STOP to stop offers.").` }],
  });
  const raw = res.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
  const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Partial<CopyPack>;
  return {
    headline: String(j.headline ?? "").slice(0, 40), ad_text: String(j.ad_text ?? "").slice(0, 600),
    instagram_caption: String(j.instagram_caption ?? ""), whatsapp_status: String(j.whatsapp_status ?? ""),
    broadcast_message: String(j.broadcast_message ?? "").slice(0, 1000),
  };
}
