// Pure credit maths. Customers see credits; the platform tracks dollars underneath.

export type RateCard = {
  version: string;
  model: string;
  input_usd_per_mtok: number;
  output_usd_per_mtok: number;
  cache_write_usd_per_mtok: number;
  cache_read_usd_per_mtok: number;
  credits_per_usd: number;
};

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export function usdCost(u: Usage, r: RateCard): number {
  const m = 1_000_000;
  return (
    (u.input_tokens * r.input_usd_per_mtok) / m +
    (u.output_tokens * r.output_usd_per_mtok) / m +
    ((u.cache_creation_input_tokens ?? 0) * r.cache_write_usd_per_mtok) / m +
    ((u.cache_read_input_tokens ?? 0) * r.cache_read_usd_per_mtok) / m
  );
}

/** Credits charged for real usage: rounded up to 0.01 so nothing is given away by rounding. */
export function creditsFor(u: Usage, r: RateCard): number {
  const raw = usdCost(u, r) * r.credits_per_usd;
  return Math.max(0, Math.ceil(raw * 100 - 1e-9) / 100);
}

/** Worst-case hold before a call: the full output budget plus an input estimate (4 chars ≈ 1 token, padded). */
export function reservationFor(inputChars: number, maxOutputTokens: number, r: RateCard): number {
  const inputTokens = Math.ceil(inputChars / 3) + 500;
  return Math.max(0.05, creditsFor({ input_tokens: inputTokens, output_tokens: maxOutputTokens }, r));
}

/** Map a database error from reserve_credits to something a business owner can act on. */
export function limitMessage(code: string): { status: number; message: string } {
  switch (code) {
    case "INSUFFICIENT_CREDITS":
      return { status: 402, message: "Your AI credits have run out. Top up or upgrade your plan in Usage & billing to keep your assistant replying." };
    case "RATE_LIMITED":
      return { status: 429, message: "Too many messages in the last minute for your plan. Wait a moment and try again." };
    case "TOO_MANY_CONCURRENT":
      return { status: 429, message: "Your assistant is already handling the maximum number of chats at once for your plan." };
    case "WORKSPACE_SUSPENDED":
      return { status: 403, message: "This workspace is paused. Contact Dall AI support." };
    case "TRIAL_ENDED":
      return { status: 402, message: "Your free trial has ended. Choose a plan in Usage & billing to keep your assistant replying." };
    case "PLAN_EXPIRED":
      return { status: 402, message: "Your plan has expired. Renew it in Usage & billing to keep your assistant replying." };
    case "NO_SUBSCRIPTION":
      return { status: 402, message: "This workspace has no active plan." };
    case "AI_DISABLED":
    case "GLOBAL_CAP":
      return { status: 503, message: "The assistant is temporarily unavailable. Please try again shortly." };
    default:
      return { status: 500, message: "Something went wrong reaching the assistant." };
  }
}

export function limitCodeFrom(err: unknown): string {
  const msg = String((err as { message?: string })?.message ?? err);
  const m = msg.match(/[A-Z_]{6,}/);
  return m ? m[0] : "UNKNOWN";
}
