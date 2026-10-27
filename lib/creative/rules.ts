// Pure rules: cost estimates, quota error messages, and which status changes are allowed.

export type ModelRow = { id: string; endpoint: string; name: string; kind: "image" | "video"; unit: "image" | "second"; usd_per_unit: number; max_seconds: number | null; allowed_params: string[]; enabled: boolean };

/** Price of one generation at the admin-configured rate. Video is priced per second. */
export function estimateCost(m: Pick<ModelRow, "unit" | "usd_per_unit" | "max_seconds">, spec: { duration_seconds?: number; variations?: number }): number {
  const n = Math.max(1, spec.variations ?? 1);
  if (m.unit === "second") {
    const secs = Math.max(1, Math.min(spec.duration_seconds ?? 5, m.max_seconds ?? 60));
    return round6(m.usd_per_unit * secs * n);
  }
  return round6(m.usd_per_unit * n);
}
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Only the keys the admin allowed for this model are sent to the provider. */
export function providerInput(m: Pick<ModelRow, "allowed_params" | "max_seconds">, spec: Record<string, unknown>): Record<string, unknown> {
  const map: Record<string, unknown> = {
    prompt: spec.prompt, negative_prompt: spec.negative || undefined, aspect_ratio: spec.aspect_ratio,
    duration: spec.duration_seconds ? Math.min(Number(spec.duration_seconds), m.max_seconds ?? 60) : undefined,
    resolution: spec.resolution || undefined, num_images: spec.variations,
  };
  return Object.fromEntries(Object.entries(map).filter(([k, v]) => m.allowed_params.includes(k) && v !== undefined && v !== ""));
}

const SCOPE: Record<string, string> = { platform: "the platform's", plan: "your plan's", org: "your business's", brand: "this brand's", user: "your personal" };
const RES: Record<string, string> = { claude_usd: "AI strategy budget", claude_tokens: "AI token allowance", research_requests: "research allowance", image_generations: "image generation allowance", video_generations: "video generation allowance", media_usd: "media generation budget" };

/** Turns a QUOTA:/NOT_CONFIGURED: database error into the exact limit, used amount and reset. */
export function quotaMessage(raw: string, resource: string, now = new Date()): { code: string; message: string } {
  const nc = raw.match(/NOT_CONFIGURED:(\w+)/);
  if (nc) return { code: "NOT_CONFIGURED", message: `Paid ${RES[nc[1]] ?? nc[1]} is switched off until a Dall AI admin sets a spending cap.` };
  const m = raw.match(/QUOTA:(\w+):(\w+):([\d.]+):([\d.]+)/);
  if (!m) return { code: "QUOTA", message: "A usage limit was reached." };
  const [, scope, period, limit, used] = m;
  const money = resource.endsWith("_usd");
  const fmt = (v: string) => (money ? `$${Number(v).toFixed(2)}` : String(Math.round(Number(v))));
  const reset = period === "day" ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const left = Math.max(0, Number(limit) - Number(used));
  return {
    code: "QUOTA",
    message: `You've reached ${SCOPE[scope] ?? scope} ${period === "day" ? "daily" : "monthly"} ${RES[resource] ?? resource}: ${fmt(used)} of ${fmt(limit)} used, ${fmt(String(left))} left. It resets on ${reset.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}. Ask an admin to raise the limit or upgrade your plan.`,
  };
}

// ---- approval state machine ----
type ItemStatus = "draft" | "awaiting_approval" | "approved" | "rejected" | "revision_requested" | "generation_queued" | "generating" | "generated" | "completed" | "failed" | "cancelled";
const ITEM: Record<ItemStatus, ItemStatus[]> = {
  draft: ["awaiting_approval", "approved", "rejected", "cancelled"],
  awaiting_approval: ["approved", "rejected", "revision_requested", "draft"],
  revision_requested: ["awaiting_approval", "draft", "cancelled"],
  rejected: ["draft", "revision_requested"],
  approved: ["generation_queued", "revision_requested", "completed", "cancelled"],
  generation_queued: ["generating", "failed", "cancelled"],
  generating: ["generated", "failed"],
  generated: ["completed", "revision_requested", "generation_queued"],
  failed: ["generation_queued", "revision_requested", "cancelled"],
  completed: ["revision_requested"],
  cancelled: ["draft"],
};
export function canMoveItem(from: string, to: string): boolean { return (ITEM[from as ItemStatus] ?? []).includes(to as ItemStatus); }

/** Items whose text may be rewritten by AI. Approved and later items are locked. */
export const EDITABLE_BY_AI = new Set(["draft", "awaiting_approval", "rejected", "revision_requested"]);

/** Higgsfield request states → our job states. */
export function jobStatusFrom(provider: string): "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled" | null {
  return (["queued", "in_progress", "completed", "failed", "nsfw", "canceled"] as const).find((s) => s === provider) ?? null;
}
/** Higgsfield doesn't bill failed, moderated or cancelled requests. */
export const NOT_CHARGED = new Set(["failed", "nsfw", "canceled"]);
