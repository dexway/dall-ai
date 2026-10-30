import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/workspace";
import { supabaseAdmin } from "@/lib/supabase/server";

async function respond(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  const accept = formData.get("to") === "accept";
  const { data: offer } = await supabaseAdmin().from("launch_video_offers").update({ status: accept ? "accepted" : "dismissed", responded_at: new Date().toISOString() })
    .eq("workspace_id", ctx.workspace.id).eq("status", "pending").select("brand_id,project_id").maybeSingle();
  revalidatePath("/dashboard", "layout");
  if (accept && offer?.brand_id) redirect(`/dashboard/studio?b=${offer.brand_id}&tab=motion${offer.project_id ? `&m=${offer.project_id}` : ""}`);
}

/** One-time pop-up: the scheduler prepared a launch video draft from the business's website. */
export default async function LaunchOffer({ workspaceId, name }: { workspaceId: string; name: string }) {
  const { data: offer, error } = await supabaseAdmin().from("launch_video_offers").select("status,website").eq("workspace_id", workspaceId).eq("status", "pending").maybeSingle();
  if (error || !offer) return null; // table not migrated yet, or nothing to offer
  return (
    <div className="launch-offer" role="dialog" aria-modal="true" aria-labelledby="launch-offer-title">
      <div className="launch-offer-card">
        <span className="launch-offer-tag">🎬 New · Content Creator</span>
        <h2 id="launch-offer-title">Make a launch video for {name}</h2>
        <p>We read what you told us and your website ({offer.website?.replace(/^https?:\/\//, "").replace(/\/$/, "")}) and started a motion-graphics launch video for you: your logo, colours and real photos, animated scene by scene for Reels, TikTok and WhatsApp Status.</p>
        <p className="muted">Check the details, add your logo and photos, and your motion director writes the storyboard. Nothing is charged until you approve.</p>
        <form action={respond} className="launch-offer-actions">
          <button className="btn btn-lime" name="to" value="accept">Make my launch video</button>
          <button className="btn btn-ghost" name="to" value="dismiss">Not now</button>
        </form>
        <small className="muted">You can always make one later in Content Creator → Motion video.</small>
      </div>
    </div>
  );
}
