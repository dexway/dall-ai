import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { AI, freeMode } from "@/lib/config";
import { creditsFor, limitCodeFrom, limitMessage, reservationFor, usdCost, type RateCard } from "@/lib/credits";

// Every model call in the product goes through gatewayCall(). Nothing else imports the SDK.

export type GatewayRequest = {
  workspaceId: string;
  feature: "chat" | "receipt_check" | "launch_kit" | "agent_test" | "followup" | "marketing_copy"
    | "creative_research" | "creative_strategy" | "creative_calendar" | "creative_spec";
  agentId?: string | null;
  userId?: string | null;
  conversationId?: string | null;
  system: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.ToolUnion[];
  maxTokens?: number;
  model?: string;
};

// Creative Director work (research, strategy, calendars) needs longer answers than a chat reply.
const LONG_FEATURES = new Set(["creative_research", "creative_strategy", "creative_calendar", "creative_spec"]);
const WEB_SEARCH_USD = 0.01; // Anthropic web search: $10 per 1,000 searches

// USD cost of each completed call (tokens + server-side web searches), for spend caps and ledgers.
const costs = new WeakMap<Anthropic.Message, number>();
export const costOf = (m: Anthropic.Message) => costs.get(m) ?? 0;
const totalUsd = (m: Anthropic.Message, rate: RateCard) =>
  usdCost(m.usage, rate) + (m.usage.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_USD;

export class GatewayError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}

type ProviderResult = { message: Anthropic.Message; requestId: string | null };
interface Provider { create(p: Anthropic.MessageCreateParamsNonStreaming): Promise<ProviderResult> }

class AnthropicProvider implements Provider {
  private client: Anthropic;
  constructor(key: string) {
    this.client = new Anthropic({ apiKey: key, timeout: AI.requestTimeoutMs, maxRetries: AI.maxRetries });
  }
  async create(p: Anthropic.MessageCreateParamsNonStreaming) {
    const { data, request_id } = await this.client.messages.create(p).withResponse();
    return { message: data, requestId: request_id ?? null };
  }
}

/** Offline stand-in, used ONLY when AI_PROVIDER=test. Its replies say so, and it records zero cost. */
class TestProvider implements Provider {
  async create(p: Anthropic.MessageCreateParamsNonStreaming): Promise<ProviderResult> {
    const last = p.messages[p.messages.length - 1];
    const text = typeof last?.content === "string" ? last.content : "your message";
    return {
      requestId: null,
      message: {
        id: "test", type: "message", role: "assistant", model: p.model, stop_reason: "end_turn", stop_sequence: null,
        content: [{ type: "text", text: `[TEST MODE · no AI key configured] I received: "${text.slice(0, 120)}"`, citations: null }],
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      } as unknown as Anthropic.Message,
    };
  }
}

function provider(): Provider {
  if (process.env.AI_PROVIDER === "test") return new TestProvider();
  const key = serverEnv.anthropicKey();
  if (!key) throw new GatewayError("AI_NOT_CONFIGURED", 503, "The AI service is not configured yet (ANTHROPIC_API_KEY is missing on the server).");
  return new AnthropicProvider(key);
}

async function loadPolicy(workspaceId: string, requestedModel?: string) {
  const db = supabaseAdmin();
  const free = freeMode();
  const { data: sub } = await db.from("platform_subscriptions").select("plan_id").eq("workspace_id", workspaceId).maybeSingle();
  if (!sub && !free) throw new GatewayError("NO_SUBSCRIPTION", 402, limitMessage("NO_SUBSCRIPTION").message);
  const { data: plan } = sub ? await db.from("platform_plans").select("*").eq("id", sub.plan_id).single() : { data: null };
  const { data: limits } = await db.from("platform_spend_limits").select("default_model").maybeSingle();
  const model = requestedModel || limits?.default_model || AI.defaultModel;
  if (!free && !plan?.allowed_models.includes(model)) throw new GatewayError("MODEL_NOT_ALLOWED", 403, `Your plan does not include ${model}.`);
  const { data: rate } = await db.from("ai_cost_rate_cards").select("*").eq("model", model)
    .lte("effective_from", new Date().toISOString()).order("effective_from", { ascending: false }).limit(1).single();
  if (!rate) throw new GatewayError("NO_RATE_CARD", 500, `No rate card for ${model}.`);
  const r: RateCard = {
    version: rate.version, model,
    input_usd_per_mtok: Number(rate.input_usd_per_mtok), output_usd_per_mtok: Number(rate.output_usd_per_mtok),
    cache_write_usd_per_mtok: Number(rate.cache_write_usd_per_mtok), cache_read_usd_per_mtok: Number(rate.cache_read_usd_per_mtok),
    credits_per_usd: Number(rate.credits_per_usd),
  };
  return { model, rate: r, maxOutput: (plan?.max_output_tokens as number | undefined) ?? 1024 };
}

// Free early access: call the model with no credit hold, and log usage at zero credits.
async function freeCall(req: GatewayRequest, model: string, rate: RateCard, maxTokens: number): Promise<Anthropic.Message> {
  const db = supabaseAdmin();
  const log = async (ok: boolean, usage: Anthropic.Usage | null, requestId: string | null, error: string | null) => {
    const u = usage ?? { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    const { error: e } = await db.from("ai_usage_events").insert({
      workspace_id: req.workspaceId, agent_id: req.agentId ?? null, user_id: req.userId ?? null, conversation_id: req.conversationId ?? null,
      feature: req.feature, model, input_tokens: u.input_tokens, output_tokens: u.output_tokens,
      cache_creation_tokens: u.cache_creation_input_tokens ?? 0, cache_read_tokens: u.cache_read_input_tokens ?? 0,
      provider_request_id: requestId, rate_card_version: rate.version, est_cost_usd: usdCost(u, rate), credits_consumed: 0,
      status: ok ? "succeeded" : "failed", error,
    });
    if (e) console.error("[gateway] free-mode usage log failed", e.message);
  };
  try {
    const { message, requestId } = await provider().create({
      model, max_tokens: maxTokens, system: req.system, messages: req.messages, ...(req.tools?.length ? { tools: req.tools } : {}),
    });
    await log(true, message.usage, requestId, null);
    costs.set(message, totalUsd(message, rate));
    return message;
  } catch (err) {
    if (err instanceof GatewayError) { await log(false, null, null, err.code); throw err; }
    const status = (err as { status?: number }).status;
    // Keep the provider's explanation (billing, bad request, auth) in the usage log; it never contains our key.
    const detail = String((err as { message?: string }).message ?? "").slice(0, 300);
    await log(false, null, null, `provider_error_${status ?? "network"}${detail ? `: ${detail}` : ""}`);
    console.error("[gateway] provider error", { status, workspace: req.workspaceId, feature: req.feature, model, detail });
    throw new GatewayError("PROVIDER_ERROR", 502, "The assistant could not reply just now. Please try again.");
  }
}

export async function gatewayCall(req: GatewayRequest): Promise<Anthropic.Message> {
  const db = supabaseAdmin();
  const { model, rate, maxOutput: planMax } = await loadPolicy(req.workspaceId, req.model);
  const maxOutput = LONG_FEATURES.has(req.feature) ? Math.max(planMax, 8000) : planMax;
  const maxTokens = Math.min(req.maxTokens ?? maxOutput, maxOutput);
  if (freeMode()) {
    // Free early access has no credit balance to stop runaway use, so cap AI calls per business per day.
    const cap = Number(process.env.FREE_DAILY_AI_CALLS) || 800;
    const { data: ok, error: capErr } = await db.rpc("hit_rate_limit", { p_key: `ai-day:${req.workspaceId}`, p_limit: cap, p_window_seconds: 86_400 });
    if (capErr) console.error("[gateway] daily cap check failed", capErr.message);
    if (ok === false) throw new GatewayError("DAILY_CAP", 402, "This assistant has reached today's free limit. It will be back tomorrow.");
    return freeCall(req, model, rate, maxTokens);
  }
  // images are billed by size (~1,600 tokens for a phone screenshot), not by their base64 length
  const msgChars = JSON.stringify(req.messages, (k, v) => (k === "data" && typeof v === "string" && v.length > 1000 ? "x".repeat(5000) : v)).length;
  const inputChars = req.system.length + msgChars + JSON.stringify(req.tools ?? []).length;
  const hold = reservationFor(inputChars, maxTokens, rate);

  const { data: resId, error: resErr } = await db.rpc("reserve_credits", { ws: req.workspaceId, amount: hold, purpose: req.feature });
  if (resErr) {
    const code = limitCodeFrom(resErr);
    const { status, message } = limitMessage(code);
    throw new GatewayError(code, status, message);
  }

  const settle = async (ok: boolean, usage: Anthropic.Usage | null, requestId: string | null, error: string | null) => {
    const u = usage ?? { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    const credits = process.env.AI_PROVIDER === "test" ? 0 : creditsFor(u, rate);
    const { error: e } = await db.rpc("settle_reservation", {
      res: resId, succeeded: ok, actual_credits: credits, p_model: model, p_feature: req.feature,
      p_input: u.input_tokens, p_output: u.output_tokens,
      p_cache_create: u.cache_creation_input_tokens ?? 0, p_cache_read: u.cache_read_input_tokens ?? 0,
      p_request_id: requestId, p_rate_version: rate.version, p_cost: usdCost(u, rate),
      p_agent: req.agentId ?? null, p_user: req.userId ?? null, p_conversation: req.conversationId ?? null, p_error: error,
    });
    // If settlement itself fails the hold expires after 5 minutes and is returned automatically.
    if (e) console.error("[gateway] settle failed", { reservation: resId, code: e.code });
  };

  try {
    const { message, requestId } = await provider().create({
      model, max_tokens: maxTokens, system: req.system, messages: req.messages, ...(req.tools?.length ? { tools: req.tools } : {}),
    });
    await settle(true, message.usage, requestId, null);
    costs.set(message, totalUsd(message, rate));
    return message;
  } catch (err) {
    if (err instanceof GatewayError) { await settle(false, null, null, err.code); throw err; }
    const status = (err as { status?: number }).status;
    await settle(false, null, null, `provider_error_${status ?? "network"}`);
    // Provider error text never contains our key; it explains bad requests, billing and auth problems.
    const detail = String((err as { message?: string }).message ?? "").slice(0, 400);
    console.error("[gateway] provider error", { status, workspace: req.workspaceId, feature: req.feature, model, detail });
    throw new GatewayError("PROVIDER_ERROR", 502, "The assistant could not reply just now. Please try again.");
  }
}
