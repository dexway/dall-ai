import "server-only";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { supabaseUser } from "@/lib/supabase/server";

export type Ctx = {
  user: { id: string; email: string | undefined };
  workspace: { id: string; name: string; slug: string; business_type: string | null; status: string };
  role: "owner" | "admin" | "staff";
  db: Awaited<ReturnType<typeof supabaseUser>>;
};

/** Signed-in user + their current workspace (first one, or the one chosen in the switcher cookie). */
export async function requireWorkspace(): Promise<Ctx> {
  const db = await supabaseUser();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: memberships } = await db.from("workspace_members")
    .select("role, workspaces(id,name,slug,business_type,status)").eq("user_id", user.id).order("created_at");
  if (!memberships?.length) redirect("/onboarding");
  const chosen = (await cookies()).get("ws")?.value;
  const m = memberships.find((x) => (x.workspaces as unknown as { id: string }).id === chosen) ?? memberships[0];
  return { user: { id: user.id, email: user.email }, workspace: m.workspaces as unknown as Ctx["workspace"], role: m.role as Ctx["role"], db };
}

export function canManage(ctx: Ctx) {
  return ctx.role === "owner" || ctx.role === "admin";
}
