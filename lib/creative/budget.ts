import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { quotaMessage } from "@/lib/creative/rules";

export class QuotaError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export type Resource = "claude_usd" | "claude_tokens" | "research_requests" | "image_generations" | "video_generations" | "media_usd";

/** Holds budget across every applicable limit (atomic in the database). Same jobRef = same hold. */
export async function reserve(a: { workspaceId: string; brandId?: string | null; userId?: string | null; resource: Resource; amount: number; jobRef: string }): Promise<string> {
  const { data, error } = await supabaseAdmin().rpc("reserve_budget", {
    p_ws: a.workspaceId, p_brand: a.brandId ?? null, p_user: a.userId ?? null, p_resource: a.resource, p_amount: a.amount, p_job_ref: a.jobRef,
  });
  if (error) {
    if (/QUOTA:|NOT_CONFIGURED/.test(error.message)) { const q = quotaMessage(error.message, a.resource); throw new QuotaError(q.code, q.message); }
    throw new Error(`budget check failed: ${error.message}`);
  }
  return data as string;
}

/** Books the real (or priced) usage against the hold; 0 releases it. Safe to call twice. */
export async function settle(reservationId: string | null | undefined, amount: number, provider: string, model: string, basis: "actual" | "estimate" = "actual") {
  if (!reservationId) return;
  const { error } = await supabaseAdmin().rpc("settle_budget", { p_res: reservationId, p_actual: Math.max(0, amount), p_provider: provider, p_model: model, p_basis: basis });
  if (error) console.error("[budget] settle failed", reservationId, error.message);
}
