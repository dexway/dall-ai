import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { AI } from "@/lib/config";
import { creditsFor, limitCodeFrom, limitMessage, reservationFor, usdCost, type RateCard } from "@/lib/credits";

// Every model call in the product goes through gatewayCall(). Nothing else imports the SDK.

export type GatewayRequest = {
  workspaceId: string;
  feature: "chat" | "receipt_check" | "launch_kit" | "agent_test";
  agentId?: string | null;
  userId?: string | null;
  conversationId?: string | null;
  system: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  maxTokens?: number;
  model?: string;
};

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
  const { data: sub } = await db.from("platform_subscriptions").select("plan_id").eq("workspace_id", workspaceId).single();
  if (!sub) throw new GatewayError("NO_SUBSCRIPTION", 402, limitMessage("NO_SUBSCRIPTION").message);
  const { data: plan } = await db.from("platform_plans").select("*").eq("id", sub.plan_id).single();
  const { data: limits } = await db.from("platform_spend_limits").select("default_model").single();
  const model = requestedModel || limits?.default_model || AI.defaultModel;
  if (!plan.allowed_models.includes(model)) throw new GatewayError("MODEL_NOT_ALLOWED", 403, `Your plan does not include ${model}.`);
  const { data: rate } = await db.from("ai_cost_rate_cards").select("*").eq("model", model)
    .lte("effective_from", new Date().toISOString()).order("effective_from", { ascending: false }).limit(1).single();
  if (!rate) throw new GatewayError("NO_RATE_CARD", 500, `No rate card for ${model}.`);
  const r: RateCard = {
    version: rate.version, model,
    input_usd_per_mtok: Number(rate.input_usd_per_mtok), output_usd_per_mtok: Number(rate.output_usd_per_mtok),
    cache_write_usd_per_mtok: Number(rate.cache_write_usd_per_mtok), cache_read_usd_per_mtok: Number(rate.cache_read_usd_per_mtok),
    credits_per_usd: Number(rate.credits_per_usd),
  };
  return { model, rate: r, maxOutput: plan.max_output_tokens as number };
}

export async function gatewayCall(req: GatewayRequest): Promise<Anthropic.Message> {
  const db = supabaseAdmin();
  const { model, rate, maxOutput } = await loadPolicy(req.workspaceId, req.model);
  const maxTokens = Math.min(req.maxTokens ?? maxOutput, maxOutput);
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
    return message;
  } catch (err) {
    if (err instanceof GatewayError) { await settle(false, null, null, err.code); throw err; }
    const status = (err as { status?: number }).status;
    await settle(false, null, null, `provider_error_${status ?? "network"}`);
    console.error("[gateway] provider error", { status, workspace: req.workspaceId, feature: req.feature });
    throw new GatewayError("PROVIDER_ERROR", 502, "The assistant could not reply just now. Please try again.");
  }
}
