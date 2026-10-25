import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireWorkspace, canManage } from "@/lib/workspace";
import { serverEnv } from "@/lib/env";
import { FACEBOOK_SCOPES, FB_REDIRECT_PATH, signState } from "@/lib/meta-oauth";

// Sends the owner to Facebook to choose the Pages and Instagram accounts to connect.
export async function GET() {
  const site = serverEnv.siteUrl();
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) return NextResponse.redirect(`${site}/dashboard/connect?error=role`);
  const nonce = randomBytes(16).toString("base64url");
  const payload = `${ctx.workspace.id}.${nonce}`;
  const u = new URL("https://www.facebook.com/v26.0/dialog/oauth");
  u.searchParams.set("client_id", process.env.NEXT_PUBLIC_META_APP_ID ?? "");
  u.searchParams.set("redirect_uri", `${site}${FB_REDIRECT_PATH}`);
  u.searchParams.set("state", `${payload}.${signState(payload)}`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", FACEBOOK_SCOPES.join(","));
  const res = NextResponse.redirect(u);
  res.cookies.set("meta_oauth", nonce, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/meta/facebook", maxAge: 600 });
  return res;
}
