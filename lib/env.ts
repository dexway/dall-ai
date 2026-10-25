// Server-only secrets are read through these helpers so a missing value fails loudly
// with the name of the setting, and so nothing secret is ever prefixed NEXT_PUBLIC_.
import "server-only";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See README → Setup.`);
  return v;
}

export const serverEnv = {
  supabaseUrl: () => need("NEXT_PUBLIC_SUPABASE_URL"),
  serviceRoleKey: () => need("SUPABASE_SERVICE_ROLE_KEY"),
  anthropicKey: () => process.env.ANTHROPIC_API_KEY || "",
  encryptionKey: () => need("ENCRYPTION_KEY"),
  platformPaystackSecret: () => process.env.PLATFORM_PAYSTACK_SECRET_KEY || "",
  siteUrl: () => process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
};
