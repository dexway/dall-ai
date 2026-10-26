import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

// Meta access lapsed: expired/invalid token (code 190), permission removed (10, 200, 230), or 401/403.
export function isAuthFailure(message: string): boolean {
  return /failed (401|403)\b|OAuthException|"code":\s*(190|10|200|230)\b|access token|session has expired/i.test(message);
}

/** Marks a channel as needing reconnection so the dashboard shows the "lost connection" banner. */
export async function flagIfAuthFailure(provider: string, externalId: string, err: unknown): Promise<void> {
  const message = (err as Error)?.message ?? String(err);
  if (!isAuthFailure(message)) return;
  await supabaseAdmin().from("channel_connections")
    .update({ status: "needs_reconnect", last_error: message.slice(0, 300), last_error_at: new Date().toISOString() })
    .eq("provider", provider).eq("external_id", externalId);
}
