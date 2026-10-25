import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin, supabaseUser } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";
import { exchangeFacebookCode, listPages, subscribePage, longLivedToken, listAdAccounts } from "@/lib/meta";
import { serverEnv } from "@/lib/env";
import { FB_REDIRECT_PATH, stateValid } from "@/lib/meta-oauth";

// Facebook sends the owner back here with a code. We save each Page the owner picked, and its linked Instagram account.
export async function GET(req: Request) {
  const site = serverEnv.siteUrl();
  const back = (q: string) => NextResponse.redirect(`${site}/dashboard/connect?${q}`);
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  if (u.searchParams.get("error") || !code) return back("error=cancelled");

  // The state must be signed by us, match the cookie from the start step, and belong to a business this person runs.
  const state = u.searchParams.get("state") ?? "";
  const parts = state.split(".");
  if (parts.length !== 3) return back("error=state");
  const [wsId, nonce, sig] = parts;
  const payload = `${wsId}.${nonce}`;
  const cookieNonce = (await cookies()).get("meta_oauth")?.value;
  if (!stateValid(payload, sig) || !cookieNonce || cookieNonce !== nonce) return back("error=state");

  const { data: { user } } = await (await supabaseUser()).auth.getUser();
  if (!user) return back("error=state");
  const db = supabaseAdmin();
  const { data: member } = await db.from("workspace_members").select("role")
    .eq("workspace_id", wsId).eq("user_id", user.id).maybeSingle();
  if (!member || !(member.role === "owner" || member.role === "admin")) return back("error=role");

  let pages, adAccounts, userToken;
  try {
    const shortToken = await exchangeFacebookCode(code, `${site}${FB_REDIRECT_PATH}`);
    userToken = await longLivedToken(shortToken);
    pages = await listPages(userToken);
    adAccounts = await listAdAccounts(userToken).catch(() => []); // ads are optional; don't fail the whole connect
  } catch (e) {
    console.error("[meta] facebook connect failed", (e as Error).message);
    return back("error=meta");
  }

  let pagesSaved = 0, igSaved = 0, skipped = 0, adsSaved = 0;
  for (const p of pages) {
    // A Page belongs to one business. Skip rather than move someone else's connection.
    const { data: other } = await db.from("channel_connections").select("workspace_id")
      .eq("provider", "facebook").eq("external_id", p.id).maybeSingle();
    if (other && other.workspace_id !== wsId) { skipped++; continue; }
    try { await subscribePage(p.access_token, p.id); }
    catch (e) { console.error("[meta] subscribe failed", (e as Error).message); skipped++; continue; }

    const enc = encryptSecret(p.access_token);
    await db.from("channel_connections").upsert({
      workspace_id: wsId, provider: "facebook", external_id: p.id, display_name: p.name, access_token_enc: enc, status: "active",
    }, { onConflict: "provider,external_id" });
    pagesSaved++;

    const ig = p.instagram_business_account;
    if (ig) {
      await db.from("channel_connections").upsert({
        workspace_id: wsId, provider: "instagram", external_id: ig.id,
        display_name: ig.username ? `@${ig.username}` : null, access_token_enc: enc, status: "active",
      }, { onConflict: "provider,external_id" });
      igSaved++;
    }
  }
  // Ad accounts: store each with the long-lived user token, so the business can run campaigns from Dall AI.
  const encUser = encryptSecret(userToken);
  for (const a of adAccounts ?? []) {
    const { data: other } = await db.from("ad_connections").select("workspace_id")
      .eq("ad_account_id", a.id).maybeSingle();
    if (other && other.workspace_id !== wsId) continue; // another business already connected this ad account
    await db.from("ad_connections").upsert({
      workspace_id: wsId, ad_account_id: a.id, name: a.name ?? null, currency: a.currency ?? null,
      access_token_enc: encUser, status: "active",
    }, { onConflict: "workspace_id,ad_account_id" });
    adsSaved++;
  }

  await db.from("financial_audit_logs").insert({ workspace_id: wsId, actor_id: user.id, action: "channel.meta_connected", entity: "workspace", entity_id: wsId, details: { pages: pagesSaved, instagram: igSaved, skipped, ad_accounts: adsSaved } });

  const res = back(`saved=facebook&pages=${pagesSaved}&ig=${igSaved}&skipped=${skipped}&ads=${adsSaved}`);
  res.cookies.set("meta_oauth", "", { path: "/api/meta/facebook", maxAge: 0 });
  return res;
}
