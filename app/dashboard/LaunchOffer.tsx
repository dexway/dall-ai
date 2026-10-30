import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/workspace";
import { supabaseAdmin } from "@/lib/supabase/server";
import "./launch-offer.css";

const SEEN = "dall_launch_ad"; // holds the sign-in time the ad was last answered for

async function respond(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  const accept = formData.get("to") === "accept";
  // Answered for this login; the next login (new sign-in time) shows it again until they create.
  (await cookies()).set(SEEN, ctx.user.signedInAt ?? "x", { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 90 });
  revalidatePath("/dashboard", "layout");
  if (!accept) return; // "Not now" keeps a prepared draft waiting for the next login
  const db = supabaseAdmin();
  const { data: offer } = await db.from("launch_video_offers").update({ status: "accepted", responded_at: new Date().toISOString() })
    .eq("workspace_id", ctx.workspace.id).eq("status", "pending").select("brand_id,project_id").maybeSingle();
  if (offer?.brand_id) redirect(`/dashboard/studio?b=${offer.brand_id}&tab=motion${offer.project_id ? `&m=${offer.project_id}` : ""}`);
  const { data: brand } = await db.from("creative_brands").select("id").eq("workspace_id", ctx.workspace.id).order("created_at").limit(1).maybeSingle();
  redirect(brand ? `/dashboard/studio?b=${brand.id}&tab=motion` : "/dashboard/studio");
}

/**
 * Launch video ad, shown once after every new login until the business has made a plan. When the
 * scheduler has prepared a draft from their website it says so; otherwise it invites them to start.
 * The stage is a small motion-graphics preview built in CSS (no media to load): it plays the
 * same beats the real video uses, hook → the new thing → call to action, on a loop.
 */
export default async function LaunchOffer({ workspaceId, name, signedInAt }: { workspaceId: string; name: string; signedInAt: string | null }) {
  if ((await cookies()).get(SEEN)?.value === (signedInAt ?? "x")) return null; // already answered this login
  const db = supabaseAdmin();
  const [{ data: offer, error }, { count: made }] = await Promise.all([
    db.from("launch_video_offers").select("status,website").eq("workspace_id", workspaceId).maybeSingle(),
    db.from("motion_projects").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).in("status", ["ready", "approved"]),
  ]);
  if (error || offer?.status === "accepted" || (made ?? 0) > 0) return null; // not migrated yet, or already creating
  const drafted = offer?.status === "pending";
  const site = offer?.website?.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "") ?? "";
  const initial = name.trim().charAt(0).toUpperCase() || "D";
  const words = name.trim().split(/\s+/).slice(0, 3);
  return (
    <div className="lo" role="dialog" aria-modal="true" aria-labelledby="lo-title" aria-describedby="lo-desc">
      <div className="lo-card">
        <div className="lo-stage" aria-hidden="true">
          <div className="lo-grid" />
          <div className="lo-glow" />
          <div className="lo-scene lo-s1">
            <span className="lo-kicker">Introducing</span>
            <p className="lo-kinetic">{words.map((w, i) => <span key={i} style={{ animationDelay: `${0.25 + i * 0.12}s` }}>{w}</span>)}</p>
          </div>
          <div className="lo-scene lo-s2">
            <div className="lo-cards">
              <i style={{ animationDelay: "0s" }} /><i style={{ animationDelay: ".12s" }} /><i style={{ animationDelay: ".24s" }} />
            </div>
            <span className="lo-tag">New</span>
          </div>
          <div className="lo-scene lo-s3">
            <span className="lo-logo">{initial}</span>
            <span className="lo-cta">Book now{site ? ` · ${site}` : ""}</span>
          </div>
          <div className="lo-hud">
            <span className="lo-rec" /> <span>Draft · 15s · 9:16</span>
            <span className="lo-bar"><b /></span>
          </div>
        </div>

        <div className="lo-body">
          <span className="lo-chip">{drafted ? "🎬 Ready for you" : "🎬 New · Content Creator"}</span>
          <h2 id="lo-title">{drafted ? `Your launch video is waiting, ${name}` : `Make a launch video for ${name}`}</h2>
          <p id="lo-desc">{drafted
            ? <>We read {site ? <b>{site}</b> : "your details"} and drafted a motion-graphics launch video: your logo, colours and real photos, animated scene by scene.</>
            : <>Turn your website, photos and offers into a scroll-stopping motion-graphics ad. Your motion director writes it; you approve it.</>}</p>
          <ul className="lo-points">
            <li>Made for Reels, TikTok and WhatsApp Status</li>
            <li>You check the storyboard first</li>
            <li>Nothing is charged until you approve</li>
          </ul>
          <form action={respond} className="lo-actions">
            <button className="btn btn-lime lo-go" name="to" value="accept">{drafted ? "Make my launch video" : "Create my launch video"} <span aria-hidden="true">→</span></button>
            <button className="btn btn-ghost" name="to" value="dismiss">Not now</button>
          </form>
          <small className="lo-later">You can always make one later in Content Creator → Motion video.</small>
        </div>
      </div>
    </div>
  );
}
