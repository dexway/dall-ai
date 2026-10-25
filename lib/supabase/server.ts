import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

/** Acts as the signed-in user: every query is filtered by row level security. */
export async function supabaseUser() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          /* called from a Server Component: the middleware refreshes the session instead */
        }
      },
    },
  });
}

/** Server-only superuser client. Use only after the code path has checked who is asking. */
export function supabaseAdmin() {
  return createClient(serverEnv.supabaseUrl(), serverEnv.serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function publicAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/brand-assets/${path}`;
}
