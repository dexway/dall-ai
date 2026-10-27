import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

/** The caller's IP as Vercel reports it (first hop of x-forwarded-for). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip") || "unknown";
}

export type Limit = { key: string; limit: number; windowSeconds: number };

/**
 * True when every limit still has room (each call counts one hit on each).
 * If the counter itself fails we let the request through and log it, so a database hiccup
 * never takes every chat offline.
 */
export async function withinLimits(limits: Limit[]): Promise<boolean> {
  const db = supabaseAdmin();
  const results = await Promise.all(limits.map(async (l) => {
    const { data, error } = await db.rpc("hit_rate_limit", { p_key: l.key, p_limit: l.limit, p_window_seconds: l.windowSeconds });
    if (error) { console.error("[rate-limit] counter failed", l.key.split(":")[0], error.message); return true; }
    return data !== false;
  }));
  return results.every(Boolean);
}

/** Limits for anonymous customer traffic on a business's public chat. */
export const CHAT_LIMITS = (ip: string, slug: string, conversationId?: string): Limit[] => [
  { key: `chat-ip-min:${ip}`, limit: 20, windowSeconds: 60 },
  { key: `chat-ip-day:${ip}`, limit: 300, windowSeconds: 86_400 },
  { key: `chat-biz-new-hour:${slug}`, limit: 400, windowSeconds: 3_600 }, // new chats started per business per hour
  ...(conversationId ? [{ key: `chat-conv:${conversationId}`, limit: 30, windowSeconds: 600 }] : []),
];
