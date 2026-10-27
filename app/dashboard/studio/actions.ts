"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireWorkspace, canManage } from "@/lib/workspace";
import { supabaseAdmin } from "@/lib/supabase/server";
import { BrandProfile } from "@/lib/creative/schemas";
import { canMoveItem } from "@/lib/creative/rules";
import { QuotaError } from "@/lib/creative/budget";
import { taskFor, chooseModel, type RoutableModel } from "@/lib/creative/router";
import { runResearch, suggestAccounts, draftStrategy, draftCalendar, regenerateItem, draftProductionSpec } from "@/lib/creative/director";
import { authorizeBatch, submitJob } from "@/lib/creative/jobs";
import { GatewayError } from "@/lib/ai/gateway";

const go = (b: string | null, tab: string, q = "") => redirect(`/dashboard/studio?${b ? `b=${b}&` : ""}tab=${tab}${q ? `&${q}` : ""}`);
const why = (e: unknown) => encodeURIComponent((e instanceof QuotaError || e instanceof GatewayError ? e.message : (e as Error).message ?? "Something went wrong.").slice(0, 300));

/** Signed-in manager of this business, and a brand that belongs to it. */
async function own(formData: FormData, needManager = true) {
  const ctx = await requireWorkspace();
  const brandId = String(formData.get("b") ?? "");
  if (needManager && !canManage(ctx)) go(brandId || null, "brief", "error=role");
  const { data: brand } = brandId ? await supabaseAdmin().from("creative_brands").select("id,workspace_id").eq("id", brandId).eq("workspace_id", ctx.workspace.id).maybeSingle() : { data: null };
  return { ctx, brand, d: { workspaceId: ctx.workspace.id, brandId: brand?.id ?? "", userId: ctx.user.id } };
}

const log = (ws: string, entity: string, id: string, action: string, actor: string, note?: string, details?: object) =>
  supabaseAdmin().from("approval_events").insert({ workspace_id: ws, entity, entity_id: id, action, actor, note: note ?? null, details: details ?? null });

export async function createBrand(formData: FormData) {
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) go(null, "brief", "error=role");
  const name = String(formData.get("name") ?? "").trim().slice(0, 80) || ctx.workspace.name;
  const { data } = await supabaseAdmin().from("creative_brands").insert({ workspace_id: ctx.workspace.id, name, created_by: ctx.user.id }).select("id").single();
  go(data!.id, "brief", "step=1");
}

export async function saveBrief(formData: FormData) {
  const { brand, ctx } = await own(formData);
  if (!brand) go(null, "brief", "error=brand");
  const list = (k: string) => formData.getAll(k).map(String).filter(Boolean);
  const s = (k: string) => String(formData.get(k) ?? "");
  const { data: cur } = await supabaseAdmin().from("creative_brands").select("profile").eq("id", brand!.id).single();
  const step = Number(formData.get("step") ?? 1);
  const patch: Record<string, unknown> = step === 1
    ? { website: s("website"), industry: s("industry"), location: s("location"), products: s("products"), audience: s("audience"), problems: s("problems"), objectives: list("objectives") }
    : { offers: s("offers"), differentiators: s("differentiators"), promotions: s("promotions"), voice: s("voice"), language: s("language"), tone: s("tone"),
        platforms: list("platforms"), frequency: s("frequency"), campaign_start: s("campaign_start"), campaign_end: s("campaign_end"), restrictions: s("restrictions"), prohibited_claims: s("prohibited_claims") };
  const parsed = BrandProfile.safeParse({ ...(cur?.profile ?? {}), ...patch });
  if (!parsed.success) go(brand!.id, "brief", `step=${step}&error=brief&why=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Check the fields")}`);
  // Uploaded reference material (logos, product photos, guidelines) goes to the private creative bucket.
  const files = formData.getAll("assets").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 6);
  const paths: string[] = [];
  for (const f of files) {
    if (f.size > 4 * 1024 * 1024 || !/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(f.type)) go(brand!.id, "brief", `step=${step}&error=asset`);
    const path = `${ctx.workspace.id}/${brand!.id}/brand/${Date.now()}-${f.name.replace(/[^\w.-]/g, "_").slice(0, 60)}`;
    const up = await supabaseAdmin().storage.from("creative-assets").upload(path, Buffer.from(await f.arrayBuffer()), { contentType: f.type });
    if (!up.error) paths.push(path);
  }
  const { data: b } = await supabaseAdmin().from("creative_brands").select("asset_paths,onboarding_step,name").eq("id", brand!.id).single();
  await supabaseAdmin().from("creative_brands").update({
    profile: parsed.data!, name: s("name") || b!.name, asset_paths: [...(b!.asset_paths ?? []), ...paths].slice(-30),
    onboarding_step: Math.max(b!.onboarding_step, step + 1), updated_at: new Date().toISOString(),
  }).eq("id", brand!.id);
  revalidatePath("/dashboard/studio");
  go(brand!.id, step >= 2 ? "accounts" : "brief", step >= 2 ? "saved=brief" : "step=2");
}

export async function addAccount(formData: FormData) {
  const { brand, ctx } = await own(formData);
  if (!brand) go(null, "accounts", "error=brand");
  const kind = String(formData.get("kind") ?? "competitor");
  const lines = String(formData.get("handles") ?? "").split(/[\n,]+/).map((x) => x.trim()).filter(Boolean).slice(0, 10);
  if (!["competitor", "inspiration", "leader", "campaign"].includes(kind) || !lines.length) go(brand!.id, "accounts", "error=account");
  await supabaseAdmin().from("creative_accounts").upsert(lines.map((h) => ({
    workspace_id: ctx.workspace.id, brand_id: brand!.id, kind, handle_or_url: h.slice(0, 300), platform: String(formData.get("platform") ?? "") || null, source: "user", accepted: true,
  })), { onConflict: "brand_id,kind,handle_or_url", ignoreDuplicates: true });
  revalidatePath("/dashboard/studio");
  go(brand!.id, "accounts");
}

export async function setAccount(formData: FormData) {
  const { brand, ctx } = await own(formData);
  const id = String(formData.get("id") ?? "");
  const db = supabaseAdmin();
  if (formData.get("op") === "remove") await db.from("creative_accounts").delete().eq("id", id).eq("workspace_id", ctx.workspace.id);
  else await db.from("creative_accounts").update({ accepted: true }).eq("id", id).eq("workspace_id", ctx.workspace.id);
  revalidatePath("/dashboard/studio");
  go(brand?.id ?? null, "accounts");
}

export async function discoverAccounts(formData: FormData) {
  const { brand, d } = await own(formData);
  if (!brand) go(null, "accounts", "error=brand");
  try { const n = await suggestAccounts(d); go(brand!.id, "accounts", `saved=suggested&n=${n}`); }
  catch (e) { if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e; go(brand!.id, "accounts", `error=ai&why=${why(e)}`); }
}

export async function startResearch(formData: FormData) {
  const { brand, ctx } = await own(formData);
  if (!brand) go(null, "research", "error=brand");
  const prefs = { depth: ["quick", "standard", "deep"].includes(String(formData.get("depth"))) ? String(formData.get("depth")) : "standard",
    geo: String(formData.get("geo") ?? "Nigeria").slice(0, 80), platforms: formData.getAll("platforms").map(String).slice(0, 7), period: String(formData.get("period") ?? "").slice(0, 60) };
  const db = supabaseAdmin();
  const { count } = await db.from("research_runs").select("id", { count: "exact", head: true }).eq("brand_id", brand!.id).in("status", ["queued", "running"]);
  if (count) go(brand!.id, "research", "error=running");
  await db.from("creative_brands").update({ research_prefs: prefs }).eq("id", brand!.id);
  const { data: run } = await db.from("research_runs").insert({ workspace_id: ctx.workspace.id, brand_id: brand!.id, prefs, created_by: ctx.user.id }).select("id").single();
  after(() => runResearch(run!.id));
  revalidatePath("/dashboard/studio");
  go(brand!.id, "research", "saved=research");
}

export async function retryResearch(formData: FormData) {
  const { brand, ctx } = await own(formData);
  const id = String(formData.get("run") ?? "");
  const { data: run } = await supabaseAdmin().from("research_runs").select("id,status").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (run?.status === "failed") { await supabaseAdmin().from("research_runs").update({ status: "queued" }).eq("id", id); after(() => runResearch(id)); }
  go(brand?.id ?? null, "research", "saved=research");
}

export async function makeStrategy(formData: FormData) {
  const { brand, d } = await own(formData);
  if (!brand) go(null, "strategy", "error=brand");
  const previousId = String(formData.get("previous") ?? "") || undefined;
  const feedback = String(formData.get("feedback") ?? "").slice(0, 1500) || undefined;
  try { await draftStrategy(d, { previousId, feedback }); }
  catch (e) { go(brand!.id, "strategy", `error=ai&why=${why(e)}`); }
  revalidatePath("/dashboard/studio");
  go(brand!.id, "strategy");
}

export async function decideStrategy(formData: FormData) {
  const { brand, ctx, d } = await own(formData);
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const db = supabaseAdmin();
  const { data: s } = await db.from("creative_strategies").select("id,status").eq("id", id).eq("brand_id", brand?.id ?? "").maybeSingle();
  if (!s || s.status !== "awaiting_approval") go(brand?.id ?? null, "strategy", "error=state");
  if (decision === "approve") {
    await db.from("creative_strategies").update({ status: "superseded" }).eq("brand_id", brand!.id).eq("status", "approved");
    await db.from("creative_strategies").update({ status: "approved", approved_by: ctx.user.id, approved_at: new Date().toISOString() }).eq("id", id);
    await log(ctx.workspace.id, "strategy", id, "approve", ctx.user.id);
  } else if (decision === "reject") {
    await db.from("creative_strategies").update({ status: "rejected", feedback: String(formData.get("feedback") ?? "") }).eq("id", id);
    await log(ctx.workspace.id, "strategy", id, "reject", ctx.user.id, String(formData.get("feedback") ?? ""));
  } else {
    const feedback = String(formData.get("feedback") ?? "").slice(0, 1500);
    await db.from("creative_strategies").update({ status: "revision_requested", feedback }).eq("id", id);
    await log(ctx.workspace.id, "strategy", id, "request_revision", ctx.user.id, feedback);
    try { await draftStrategy(d, { previousId: id, feedback }); } catch (e) { go(brand!.id, "strategy", `error=ai&why=${why(e)}`); }
  }
  revalidatePath("/dashboard/studio");
  go(brand!.id, "strategy");
}

export async function makeCalendar(formData: FormData) {
  const { brand, d } = await own(formData);
  const strategyId = String(formData.get("strategy") ?? "");
  const month = String(formData.get("month") ?? "").match(/^\d{4}-\d{2}$/) ? `${formData.get("month")}-01` : new Date().toISOString().slice(0, 8) + "01";
  try { const id = await draftCalendar(d, strategyId, month); revalidatePath("/dashboard/studio"); go(brand!.id, "calendar", `cal=${id}`); }
  catch (e) { if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e; go(brand?.id ?? null, "calendar", `error=ai&why=${why(e)}`); }
}

/** Approve / reject / request revision / edit / reorder / remove one calendar item. */
export async function itemAction(formData: FormData) {
  const { brand, ctx, d } = await own(formData);
  const id = String(formData.get("id") ?? "");
  const op = String(formData.get("op") ?? "");
  const cal = String(formData.get("cal") ?? "");
  const db = supabaseAdmin();
  const { data: it } = await db.from("content_items").select("*").eq("id", id).eq("brand_id", brand?.id ?? "").maybeSingle();
  if (!it) go(brand?.id ?? null, "calendar", "error=state");
  const back = () => go(brand!.id, "calendar", `cal=${cal}#item-${id}`);
  const move = async (to: string, extra: Record<string, unknown> = {}) => {
    if (!canMoveItem(it!.status, to)) go(brand!.id, "calendar", `cal=${cal}&error=state&why=${encodeURIComponent(`Can't go from ${it!.status} to ${to}.`)}`);
    await db.from("content_items").update({ status: to, updated_at: new Date().toISOString(), ...extra }).eq("id", id);
  };
  if (op === "approve") { await move("approved", { approved_by: ctx.user.id, approved_at: new Date().toISOString() }); await log(ctx.workspace.id, "item", id, "approve", ctx.user.id); }
  else if (op === "reject") { await move("rejected", { feedback: String(formData.get("feedback") ?? "") }); await log(ctx.workspace.id, "item", id, "reject", ctx.user.id); }
  else if (op === "revise") {
    const fb = String(formData.get("feedback") ?? "").slice(0, 1000);
    if (["approved", "generated", "completed", "failed"].includes(it!.status)) await move("revision_requested", { feedback: fb });
    await log(ctx.workspace.id, "item", id, "regenerate", ctx.user.id, fb);
    try { await regenerateItem(d, id, fb); } catch (e) { go(brand!.id, "calendar", `cal=${cal}&error=ai&why=${why(e)}`); }
  } else if (op === "edit") {
    if (!["draft", "awaiting_approval", "rejected", "revision_requested"].includes(it!.status)) go(brand!.id, "calendar", `cal=${cal}&error=locked`);
    const idea = { ...(it!.idea as Record<string, unknown>), hook: String(formData.get("hook") ?? ""), caption: String(formData.get("caption") ?? ""), cta: String(formData.get("cta") ?? ""), visual_direction: String(formData.get("visual_direction") ?? "") };
    await db.from("content_items").update({ idea, planned_date: String(formData.get("planned_date") ?? it!.planned_date), version: it!.version + 1, status: "awaiting_approval", updated_at: new Date().toISOString() }).eq("id", id);
    await log(ctx.workspace.id, "item", id, "edit", ctx.user.id);
  } else if (op === "remove") {
    if (!["draft", "awaiting_approval", "rejected", "revision_requested", "cancelled"].includes(it!.status)) go(brand!.id, "calendar", `cal=${cal}&error=locked`);
    await db.from("content_items").delete().eq("id", id);
  } else if (op === "up" || op === "down") {
    const { data: all } = await db.from("content_items").select("id,position").eq("calendar_id", it!.calendar_id).order("position");
    const i = (all ?? []).findIndex((x) => x.id === id), j = op === "up" ? i - 1 : i + 1;
    if (all && j >= 0 && j < all.length) {
      await db.from("content_items").update({ position: all[j].position }).eq("id", all[i].id);
      await db.from("content_items").update({ position: all[i].position }).eq("id", all[j].id);
    }
  }
  revalidatePath("/dashboard/studio");
  back();
}

export async function approveCalendar(formData: FormData) {
  const { brand, ctx } = await own(formData);
  const id = String(formData.get("cal") ?? "");
  const db = supabaseAdmin();
  const { data: c } = await db.from("content_calendars").select("id").eq("id", id).eq("brand_id", brand?.id ?? "").maybeSingle();
  if (!c) go(brand?.id ?? null, "calendar", "error=state");
  await db.from("content_calendars").update({ status: "approved", approved_by: ctx.user.id, approved_at: new Date().toISOString() }).eq("id", id);
  await log(ctx.workspace.id, "calendar", id, "approve", ctx.user.id, "Calendar approved. Items still need their own approval before any paid generation.");
  revalidatePath("/dashboard/studio");
  go(brand!.id, "calendar", `cal=${id}`);
}

export async function prepareSpec(formData: FormData) {
  const { brand, d } = await own(formData);
  const id = String(formData.get("id") ?? "");
  const modelId = String(formData.get("model") ?? "auto");
  const db = supabaseAdmin();
  let m: { id: string; name: string; kind: "image" | "video"; max_seconds: number | null; enabled: boolean } | null = null;
  if (modelId === "auto") {
    // The Creative Director picks the best enabled model for this item's task.
    const [{ data: item }, { data: models }, { data: b }] = await Promise.all([
      db.from("content_items").select("format,idea").eq("id", id).eq("brand_id", brand!.id).maybeSingle(),
      db.from("provider_models").select("*").eq("enabled", true),
      db.from("creative_brands").select("asset_paths").eq("id", brand!.id).single(),
    ]);
    const idea = JSON.stringify(item?.idea ?? {}).toLowerCase();
    const task = taskFor({ format: item?.format ?? "static_image", hasReference: (b?.asset_paths ?? []).some((p: string) => /\.(png|jpe?g|webp)$/i.test(p)), needsText: /₦|price|% off|offer|discount/.test(idea) });
    m = (chooseModel(task, (models ?? []) as RoutableModel[])?.model as unknown as typeof m) ?? null;
  } else {
    m = (await db.from("provider_models").select("id,name,kind,max_seconds,enabled").eq("id", modelId).maybeSingle()).data;
  }
  if (!m?.enabled) go(brand?.id ?? null, "production", "error=model");
  try {
    const spec = await draftProductionSpec(d, id, m!);
    await db.from("content_items").update({ spec, spec_model_id: m!.id }).eq("id", id).eq("brand_id", brand!.id);
  } catch (e) { go(brand!.id, "production", `error=ai&why=${why(e)}`); }
  revalidatePath("/dashboard/studio");
  go(brand!.id, "production");
}

export async function generateBatch(formData: FormData) {
  const { brand, d, ctx } = await own(formData);
  const ids = formData.getAll("items").map(String).filter(Boolean);
  const confirmed = Number(formData.get("confirmed_total"));
  if (formData.get("confirm") !== "yes") go(brand?.id ?? null, "production", "error=confirm");
  let jobs: string[] = [];
  try { jobs = await authorizeBatch({ ...d, itemIds: ids, confirmedTotal: confirmed }); }
  catch (e) { go(brand?.id ?? null, "production", `error=quota&why=${why(e)}`); }
  void ctx;
  after(async () => { for (const j of jobs) await submitJob(j); });
  revalidatePath("/dashboard/studio");
  go(brand!.id, "production", `saved=generating&n=${jobs.length}`);
}
