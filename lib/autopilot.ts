import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";
import { connectionFor } from "@/lib/channels/process";
import { draftCalendar, draftProductionSpec } from "@/lib/creative/director";
import { quoteBatch, authorizeBatch, submitJob } from "@/lib/creative/jobs";
import { taskFor, chooseModel, type RoutableModel } from "@/lib/creative/router";
import { publishFacebook, publishInstagram, buildCaption, publishTime, PublishError, type Media } from "@/lib/social-publish";

const lagosToday = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

/** Picks the best enabled model for an approved item and writes its production spec. */
export async function autoPrepare(ctx: { workspaceId: string; brandId: string; userId: string }, itemId: string): Promise<boolean> {
  const db = supabaseAdmin();
  const [{ data: item }, { data: models }, { data: b }] = await Promise.all([
    db.from("content_items").select("format,idea").eq("id", itemId).eq("brand_id", ctx.brandId).maybeSingle(),
    db.from("provider_models").select("*").eq("enabled", true),
    db.from("creative_brands").select("asset_paths").eq("id", ctx.brandId).single(),
  ]);
  if (!item) return false;
  const idea = JSON.stringify(item.idea ?? {}).toLowerCase();
  const task = taskFor({ format: item.format, hasReference: (b?.asset_paths ?? []).some((p: string) => /\.(png|jpe?g|webp)$/i.test(p)), needsText: /₦|price|% off|offer|discount/.test(idea) });
  const m = chooseModel(task, (models ?? []) as (RoutableModel & { name: string; max_seconds: number | null })[])?.model;
  if (!m) return false;
  const spec = await draftProductionSpec(ctx, itemId, m);
  await db.from("content_items").update({ spec, spec_model_id: m.id }).eq("id", itemId);
  return true;
}

/** New deals → broadcast to customers who opted in (Messenger/Instagram inside the 24h window). */
async function announceDeals(log: string[]) {
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const { data: promos } = await db.from("promotions").select("*").eq("announce", true).eq("active", true).is("announced_at", null).lte("starts_at", now).limit(10);
  for (const p of promos ?? []) {
    if (p.ends_at && p.ends_at < now) continue;
    const { data: claimed } = await db.from("promotions").update({ announced_at: now }).eq("id", p.id).is("announced_at", null).select("id");
    if (!claimed?.length) continue;
    const off = p.kind === "percent" ? `${p.value}% off` : `₦${Math.round(Number(p.value) / 100).toLocaleString("en-NG")} off`;
    const message = (p.announce_message || `New deal: ${p.title}. ${off} with code ${p.code}. Reply here to order!`) + "\n\nReply STOP to stop offers.";
    for (const channel of ["facebook", "instagram"]) {
      const conn = await connectionFor(p.workspace_id, channel);
      if (!conn || conn.status !== "active") continue;
      await db.from("broadcasts").insert({ workspace_id: p.workspace_id, title: `Deal: ${p.title}`, channel, message, promo_code: p.code, status: "sending" });
      log.push(`deal ${p.code} → ${channel}`);
    }
  }
}

/** On the 20th onward, draft next month's calendar from the approved strategy (items still need approval). */
async function autoPlan(log: string[]) {
  const today = lagosToday();
  if (Number(today.slice(8, 10)) < 20) return;
  const next = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1)).toISOString().slice(0, 10);
  const db = supabaseAdmin();
  const { data: rows } = await db.from("creative_autopilot").select("*").eq("auto_plan", true).not("brand_id", "is", null);
  for (const a of rows ?? []) {
    const { data: existing } = await db.from("content_calendars").select("id").eq("brand_id", a.brand_id).eq("month", next).neq("status", "failed").limit(1);
    if (existing?.length) continue;
    const { data: strat } = await db.from("creative_strategies").select("id").eq("brand_id", a.brand_id).eq("status", "approved").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!strat || !a.updated_by) continue;
    try { await draftCalendar({ workspaceId: a.workspace_id, brandId: a.brand_id, userId: a.updated_by }, strat.id, next); log.push(`planned ${next}`); }
    catch (e) { log.push(`plan failed: ${(e as Error).message.slice(0, 80)}`); }
    return; // one AI plan per run keeps the cron fast
  }
}

/** Approved items due within 3 days get a spec and are generated, inside the owner's monthly cap. */
async function autoGenerate(log: string[], deadline: number) {
  const db = supabaseAdmin();
  const today = lagosToday();
  const { data: rows } = await db.from("creative_autopilot").select("*").eq("auto_generate", true).gt("monthly_media_cap_usd", 0).not("brand_id", "is", null);
  for (const a of rows ?? []) {
    if (Date.now() > deadline || !a.updated_by) return;
    const ctx = { workspaceId: a.workspace_id, brandId: a.brand_id, userId: a.updated_by };
    const { data: items } = await db.from("content_items").select("id,spec").eq("brand_id", a.brand_id).eq("status", "approved").gte("planned_date", today).lte("planned_date", addDays(today, 3)).limit(3);
    const ready: string[] = [];
    for (const it of items ?? []) {
      if (Date.now() > deadline) break;
      try { if (it.spec || (await autoPrepare(ctx, it.id))) ready.push(it.id); } catch (e) { log.push(`spec failed: ${(e as Error).message.slice(0, 60)}`); }
    }
    if (!ready.length) continue;
    try {
      const q = await quoteBatch(a.workspace_id, ready);
      const ids = q.lines.map((l) => l.itemId);
      if (!ids.length) continue;
      const jobs = await authorizeBatch({ ...ctx, itemIds: ids, confirmedTotal: q.total });
      for (const j of jobs) await submitJob(j);
      log.push(`generating ${jobs.length}`);
    } catch (e) { log.push(`generate blocked: ${(e as Error).message.slice(0, 80)}`); }
  }
}

/** Schedules finished posts for their date, then publishes the ones that are due. */
async function autoPublish(log: string[], deadline: number) {
  const db = supabaseAdmin();
  const today = lagosToday();
  const { data: rows } = await db.from("creative_autopilot").select("*").eq("auto_publish", true).not("brand_id", "is", null);
  for (const a of rows ?? []) {
    const { data: fresh } = await db.from("content_items").select("id,planned_date").eq("brand_id", a.brand_id).in("status", ["generated", "completed"]).is("publish_status", null).gte("planned_date", today).limit(50);
    for (const it of fresh ?? []) await db.from("content_items").update({ publish_status: "scheduled", publish_at: publishTime(it.planned_date, a.publish_hour).toISOString() }).eq("id", it.id).is("publish_status", null);
  }
  const { data: due } = await db.from("content_items").select("id,workspace_id,brand_id,platform,idea,post_refs,publish_attempts").eq("publish_status", "scheduled").lte("publish_at", new Date().toISOString()).limit(5);
  for (const it of due ?? []) {
    if (Date.now() > deadline) return;
    const { data: claimed } = await db.from("content_items").update({ publish_status: "publishing", publish_attempts: it.publish_attempts + 1 }).eq("id", it.id).eq("publish_status", "scheduled").select("id");
    if (!claimed?.length) continue;
    const { data: ap } = await db.from("creative_autopilot").select("channels,auto_publish").eq("workspace_id", it.workspace_id).maybeSingle();
    const { data: asset } = await db.from("creative_assets").select("path,kind").eq("item_id", it.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!ap?.auto_publish || !asset) { await db.from("content_items").update({ publish_status: "skipped", publish_error: !asset ? "No finished image or video." : "Autopilot publishing is off." }).eq("id", it.id); continue; }
    const { data: signed } = await db.storage.from("creative-assets").createSignedUrl(asset.path, 3600);
    const media: Media = { url: signed!.signedUrl, kind: asset.kind === "video" ? "video" : "image" };
    const caption = buildCaption(it.idea ?? {});
    // Facebook/Instagram items post to that network; other platforms (TikTok, X...) aren't auto-postable yet.
    const want = ["facebook", "instagram"].includes(it.platform) && (ap.channels as string[]).includes(it.platform) ? [it.platform as string] : [];
    if (!want.length) { await db.from("content_items").update({ publish_status: "skipped", publish_error: `Auto-posting to ${it.platform} isn't available; post it yourself.` }).eq("id", it.id); continue; }
    const refs: Record<string, string> = { ...(it.post_refs ?? {}) };
    const errors: string[] = [];
    let retry = false;
    for (const ch of want) {
      if (refs[ch]) continue; // already posted there: never double-post
      const conn = await connectionFor(it.workspace_id, ch);
      if (!conn || conn.status !== "active") { errors.push(`${ch} not connected`); continue; }
      try {
        const token = decryptSecret(conn.access_token_enc);
        refs[ch] = ch === "instagram" ? await publishInstagram({ igUserId: conn.external_id, token, caption, media }) : await publishFacebook({ pageId: conn.external_id, token, caption, media });
      } catch (e) { errors.push(`${ch}: ${(e as Error).message.slice(0, 200)}`); if ((e as PublishError).retryable) retry = true; }
    }
    const posted = Object.keys(refs).length > 0;
    const status = retry && it.publish_attempts + 1 < 4 ? "scheduled" : posted ? "published" : "failed";
    await db.from("content_items").update({ publish_status: status, post_refs: refs, publish_error: errors.join(" · ") || null, published_at: posted ? new Date().toISOString() : null, ...(status === "scheduled" ? { publish_at: new Date(Date.now() + 15 * 60_000).toISOString() } : {}), ...(status === "published" ? { status: "completed" } : {}) }).eq("id", it.id);
    log.push(`post ${it.id.slice(0, 8)}: ${status}`);
  }
}

export async function runAutopilot(budgetMs = 30_000): Promise<string[]> {
  const deadline = Date.now() + budgetMs;
  const log: string[] = [];
  for (const step of [announceDeals, (l: string[]) => autoPublish(l, deadline), (l: string[]) => autoGenerate(l, deadline), autoPlan]) {
    if (Date.now() > deadline) break;
    try { await step(log); } catch (e) { log.push(`autopilot step failed: ${(e as Error).message.slice(0, 120)}`); }
  }
  return log;
}
