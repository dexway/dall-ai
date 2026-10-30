import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { BrandProfile } from "@/lib/creative/schemas";
import { prefillMotionBrief } from "@/lib/creative/motion";

const validSite = (u: unknown): string | null => {
  const s = typeof u === "string" ? u.trim() : "";
  try { const x = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); return x.hostname.includes(".") ? x.toString() : null; } catch { return null; }
};

/**
 * Runs from the 5-minute scheduler. Every business that has given a website (at sign-up, in the
 * assistant studio or in the Content Creator brief) and hasn't been offered one yet gets a launch video
 * draft prepared from what Dall AI already knows, plus a pending offer the dashboard shows as a pop-up.
 * Nothing is generated or charged: the owner opens the draft and decides.
 */
export async function offerLaunchVideos(limit = 20): Promise<number> {
  const db = supabaseAdmin();
  const [{ data: agents }, { data: brands }, { data: wss }] = await Promise.all([
    db.from("agents").select("workspace_id,website_url,knowledge").not("website_url", "is", null).limit(500),
    db.from("creative_brands").select("workspace_id,profile").not("profile->>website", "is", null).neq("profile->>website", "").limit(500),
    db.from("workspaces").select("id").not("business_profile->>website", "is", null).neq("business_profile->>website", "").limit(500),
  ]);
  const candidates = new Set([...(agents ?? []), ...(brands ?? [])].map((r) => r.workspace_id as string).concat((wss ?? []).map((w) => w.id)));
  if (!candidates.size) return 0;
  const { data: done } = await db.from("launch_video_offers").select("workspace_id").in("workspace_id", [...candidates]);
  const offered = new Set((done ?? []).map((d) => d.workspace_id));
  let made = 0;
  for (const ws of candidates) {
    if (made >= limit) break;
    if (offered.has(ws)) continue;
    const { data: w } = await db.from("workspaces").select("id,name,business_type,business_profile,created_by").eq("id", ws).maybeSingle();
    if (!w) continue;
    const agent = (agents ?? []).find((a) => a.workspace_id === ws);
    let { data: brand } = await db.from("creative_brands").select("id,name,profile").eq("workspace_id", ws).order("created_at").limit(1).maybeSingle();
    const site = validSite(BrandProfile.parse(brand?.profile ?? {}).website) ?? validSite(agent?.website_url) ?? validSite((w.business_profile as { website?: string })?.website);
    if (!site) continue;
    // Claim first so two scheduler runs never prepare two offers for the same business.
    const { error: claimErr } = await db.from("launch_video_offers").insert({ workspace_id: ws, website: site });
    if (claimErr) continue;
    if (!brand) {
      const profile = BrandProfile.parse({ website: site, industry: w.business_type ?? "", products: String(agent?.knowledge ?? "").slice(0, 2000) });
      brand = (await db.from("creative_brands").insert({ workspace_id: ws, name: w.name, profile, created_by: w.created_by }).select("id,name,profile").single()).data;
    } else if (!BrandProfile.parse(brand.profile ?? {}).website) {
      await db.from("creative_brands").update({ profile: { ...(brand.profile ?? {}), website: site } }).eq("id", brand.id);
    }
    if (!brand) continue;
    const brief = { ...prefillMotionBrief(BrandProfile.parse({ ...(brand.profile ?? {}), website: site }), null, brand.name), kind: "launch" as const, launch_what: w.name };
    const { data: proj } = await db.from("motion_projects").insert({ workspace_id: ws, brand_id: brand.id, brief, created_by: w.created_by }).select("id").single();
    await db.from("launch_video_offers").update({ brand_id: brand.id, project_id: proj?.id ?? null }).eq("workspace_id", ws);
    made++;
  }
  return made;
}
