import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/workspace";
import { supabaseAdmin } from "@/lib/supabase/server";
import "./launch-offer.css";

async function respond(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  const accept = formData.get("to") === "accept";
  const { data: offer } = await supabaseAdmin().from("launch_video_offers").update({ status: accept ? "accepted" : "dismissed", responded_at: new Date().toISOString() })
    .eq("workspace_id", ctx.workspace.id).eq("status", "pending").select("brand_id,project_id").maybeSingle();
  revalidatePath("/dashboard", "layout");
  if (accept && offer?.brand_id) redirect(`/dashboard/studio?b=${offer.brand_id}&tab=motion${offer.project_id ? `&m=${offer.project_id}` : ""}`);
}

/**
 * One-time pop-up: the scheduler prepared a launch video draft from the business's website.
 * The stage is a small motion-graphics preview built in CSS (no media to load): it plays the
 * same beats the real video uses, hook → the new thing → call to action, on a loop.
 */
export default async function LaunchOffer({ workspaceId, name }: { workspaceId: string; name: string }) {
  const { data: offer, error } = await supabaseAdmin().from("launch_video_offers").select("status,website").eq("workspace_id", workspaceId).eq("status", "pending").maybeSingle();
  if (error || !offer) return null; // table not migrated yet, or nothing to offer
  const site = offer.website?.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "") ?? "";
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
          <span className="lo-chip">🎬 Ready for you</span>
          <h2 id="lo-title">Your launch video is waiting, {name}</h2>
          <p id="lo-desc">We read {site ? <b>{site}</b> : "your details"} and drafted a motion-graphics launch video: your logo, colours and real photos, animated scene by scene.</p>
          <ul className="lo-points">
            <li>Made for Reels, TikTok and WhatsApp Status</li>
            <li>You check the storyboard first</li>
            <li>Nothing is charged until you approve</li>
          </ul>
          <form action={respond} className="lo-actions">
            <button className="btn btn-lime lo-go" name="to" value="accept">Make my launch video <span aria-hidden="true">→</span></button>
            <button className="btn btn-ghost" name="to" value="dismiss">Not now</button>
          </form>
          <small className="lo-later">You can always make one later in Content Creator → Motion video.</small>
        </div>
      </div>
    </div>
  );
}
