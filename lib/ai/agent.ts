import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { gatewayCall } from "@/lib/ai/gateway";
import { supabaseAdmin } from "@/lib/supabase/server";
import { AI } from "@/lib/config";
import { formatNaira, QuoteError } from "@/lib/money";
import { createCheckout, checkoutUrl } from "@/lib/orders";

export type AgentRow = {
  id: string; workspace_id: string; name: string; role_title: string; persona: string;
  languages: string[]; greeting: string; max_discount_pct: number;
};

const STATUS_WORDS: Record<string, string> = {
  awaiting_payment: "waiting for payment",
  payment_evidence_submitted: "transfer receipt received, being checked",
  verification_pending: "payment being checked by the team",
  payment_confirmed: "PAID and confirmed",
  payment_rejected: "payment could not be confirmed",
  payment_failed: "payment failed",
  payment_expired: "payment window expired",
  order_fulfilled: "completed",
};

const tools: Anthropic.Tool[] = [
  {
    name: "search_catalogue",
    description: "Search this business's live catalogue. Always call this before naming a price, product or service.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Words to match; empty for everything" } } },
  },
  {
    name: "create_checkout",
    description: "Create a checkout once the customer has chosen. The server computes every price; you only pass item ids and quantities. Returns the exact total and a link the customer opens to review and pay.",
    input_schema: {
      type: "object",
      required: ["items"],
      properties: {
        items: { type: "array", items: { type: "object", required: ["item_id", "quantity"], properties: { item_id: { type: "string" }, quantity: { type: "integer", minimum: 1 } } } },
        customer_name: { type: "string" }, customer_phone: { type: "string" }, customer_email: { type: "string" },
        discount_pct: { type: "number", description: "Only within your allowed limit, and only if the customer asked." },
      },
    },
  },
  {
    name: "check_order",
    description: "Look up an order's payment status by its reference (e.g. MAM-7KQ2X9PD). Use this before telling anyone their payment is confirmed.",
    input_schema: { type: "object", required: ["reference"], properties: { reference: { type: "string" } } },
  },
];

function systemPrompt(agent: AgentRow, businessName: string, profile: string) {
  return `You are ${agent.name}, the ${agent.role_title} for ${businessName}, a business in Lagos, Nigeria.
Personality: ${agent.persona}
Languages: reply in whichever of ${agent.languages.join(", ")} the customer uses. Nigerian Pidgin is welcome when they use it.

About this business (answer delivery, hours and policy questions from this. If a detail is not listed, say the team will confirm it):
${profile || "- Not filled in yet. If asked about delivery times or hours, say the team will confirm."}

Rules you never break:
- Only quote products, services and prices returned by search_catalogue. Never invent an item, price, bonus or promotion.
- Prices are in naira. Say exact amounts.
- You may offer a discount only if the customer asks, and never above ${agent.max_discount_pct}%. ${agent.max_discount_pct === 0 ? "You cannot give any discount; offer to pass the request to the team." : ""}
- When the customer is ready, call create_checkout. If it returns bank details, list them clearly (bank, account number, account name, exact amount, reference as narration) and the time limit, then ask them to send their transfer screenshot here with the 📎 button. Only share a checkout link if the tool returns one.
- If a checkout includes early_payment, tell the customer once, in plain words: the early amount, the minutes left, and the percentage they save for paying inside the countdown.
- When a receipt arrives, never say it is confirmed. Say it has been received and the team is verifying it.
- Never say a payment is confirmed unless check_order says "PAID and confirmed". A transfer screenshot is not proof; say it is being checked.
- Never ask for card numbers, PINs, OTPs or banking passwords.
- If you cannot help, say a team member will follow up.
Keep replies short and friendly, like a WhatsApp message.`;
}

async function runTool(name: string, input: Record<string, unknown>, ctx: { agent: AgentRow; businessName: string; conversationId: string }) {
  const db = supabaseAdmin();
  const ws = ctx.agent.workspace_id;
  try {
    if (name === "search_catalogue") {
      const q = String(input.query ?? "").trim();
      let query = db.from("catalogue_items").select("id,kind,name,description,price_kobo,intro_price_kobo,stock,terms")
        .eq("workspace_id", ws).eq("active", true).limit(25);
      if (q) query = query.or(`name.ilike.%${q.replace(/[%,()]/g, " ")}%,description.ilike.%${q.replace(/[%,()]/g, " ")}%`);
      const { data } = await query;
      if (!data?.length) return { items: [], note: "Nothing matched. Offer what is available or ask a clarifying question." };
      return {
        items: data.map((i) => ({
          item_id: i.id, kind: i.kind, name: i.name, description: i.description?.slice(0, 200),
          price: formatNaira(i.intro_price_kobo ?? i.price_kobo),
          ...(i.intro_price_kobo != null ? { usual_price: formatNaira(i.price_kobo) } : {}),
          in_stock: i.stock === null ? "yes" : i.stock, terms: i.terms ?? undefined,
        })),
      };
    }
    if (name === "create_checkout") {
      const { order, quote } = await createCheckout({
        workspaceId: ws, workspaceName: ctx.businessName, conversationId: ctx.conversationId,
        maxDiscountPct: Number(ctx.agent.max_discount_pct),
        items: (input.items as { item_id: string; quantity: number }[]) ?? [],
        discountPct: input.discount_pct ? Number(input.discount_pct) : 0,
        customer: { name: input.customer_name as string, phone: input.customer_phone as string, email: input.customer_email as string },
      });
      const { data: bank } = await db.from("business_payment_settings").select("bank_name,account_name,account_number,transfer_instructions,early_pay_bonus_pct").eq("workspace_id", ws).single();
      const base = {
        reference: order.reference,
        lines: quote.lines.map((l) => `${l.quantity} × ${l.name} @ ${formatNaira(l.unit_price_kobo)} = ${formatNaira(l.line_total_kobo)}`),
        discount: quote.discount_kobo ? formatNaira(quote.discount_kobo) : undefined,
        total: formatNaira(quote.total_kobo),
      };
      if (bank?.account_number) {
        const mins = order.expires_at ? Math.max(1, Math.round((new Date(order.expires_at).getTime() - Date.now()) / 60_000)) : null;
        return {
          ...base,
          pay_by_transfer: { bank: bank.bank_name, account_number: bank.account_number, account_name: bank.account_name, narration: order.reference, extra: bank.transfer_instructions ?? undefined },
          minutes_to_pay: mins,
          ...(order.early_total_kobo != null ? { early_payment: {
            percent_saved: bank.early_pay_bonus_pct,
            pay_amount: formatNaira(order.early_total_kobo),
            full_amount: formatNaira(quote.total_kobo),
            pay_within_minutes: mins,
          } } : {}),
          next_step: "Give the customer these exact bank details, the exact total, and the reference to use as narration. Tell them they have the minutes_to_pay shown (a timer is on their screen), and that once paid they should tap the 📎 button in this chat to send a clear screenshot showing the amount, our account name/number, date and transaction reference.",
        };
      }
      return { ...base, checkout_link: checkoutUrl(order.public_token), next_step: "Share the checkout link; the customer pays there." };
    }
    if (name === "check_order") {
      const { data } = await db.from("orders").select("reference,status,total_kobo").eq("workspace_id", ws)
        .eq("reference", String(input.reference ?? "").toUpperCase().trim()).maybeSingle();
      if (!data) return { error: "No order with that reference for this business." };
      return { reference: data.reference, status: STATUS_WORDS[data.status] ?? data.status, total: formatNaira(data.total_kobo) };
    }
    return { error: `Unknown tool ${name}` };
  } catch (e) {
    if (e instanceof QuoteError) return { error: e.message };
    console.error("[agent] tool failed", name, (e as Error).message);
    return { error: "That action failed on our side. Apologise and offer a team follow-up." };
  }
}

/** One customer message in, one assistant reply out. Tool loops are capped. */
export async function runAgentTurn(args: {
  agent: AgentRow; businessName: string; conversationId: string; history: Anthropic.MessageParam[]; userText: string; profile?: string;
}): Promise<string> {
  const messages: Anthropic.MessageParam[] = [...args.history.slice(-AI.maxHistoryMessages), { role: "user", content: args.userText }];
  const system = systemPrompt(args.agent, args.businessName, args.profile ?? "");

  for (let step = 0; step <= AI.maxToolCallsPerTurn; step++) {
    const res = await gatewayCall({
      workspaceId: args.agent.workspace_id, feature: "chat", agentId: args.agent.id, conversationId: args.conversationId,
      system, messages, tools: step < AI.maxToolCallsPerTurn ? tools : undefined,
    });
    const toolUses = res.content.filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !toolUses.length) {
      return res.content.filter((c): c is Anthropic.TextBlock => c.type === "text").map((c) => c.text).join("\n").trim()
        || "Sorry, could you say that again?";
    }
    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const t of toolUses) {
      const out = await runTool(t.name, t.input as Record<string, unknown>, args);
      results.push({ type: "tool_result", tool_use_id: t.id, content: JSON.stringify(out), is_error: "error" in out });
    }
    messages.push({ role: "user", content: results });
  }
  return "Let me get a team member to help you with this. Someone will reply shortly.";
}
