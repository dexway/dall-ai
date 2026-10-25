import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";

// Permissions for Messenger DMs and ads so a business can run campaigns from Dall AI.
// Instagram DM scopes (instagram_basic, instagram_manage_messages) are added back once the
// Instagram use case is configured for the app — Facebook rejects them until then.
// Other businesses only get these after Meta App Review.
export const FACEBOOK_SCOPES = [
  "pages_show_list", "pages_messaging", "pages_manage_metadata", "business_management",
  "ads_management", "ads_read",
];

export const FB_REDIRECT_PATH = "/api/meta/facebook/callback";

/** Signs the login state, so a returning login can only be used for the business that started it. */
export function signState(payload: string): string {
  return createHmac("sha256", serverEnv.encryptionKey()).update(payload).digest("base64url");
}

export function stateValid(payload: string, sig: string): boolean {
  const expected = Buffer.from(signState(payload));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
