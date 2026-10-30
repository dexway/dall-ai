import "server-only";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { reserve, settle, QuotaError } from "@/lib/creative/budget";
import { estimateCost, providerInput, jobStatusFrom, NOT_CHARGED, type ModelRow } from "@/lib/creative/rules";
import { hfSubmit, hfStatus, hfOutputs, HfError } from "@/lib/creative/higgsfield";
import { ProductionSpec } from "@/lib/creative/schemas";
import { MotionPack } from "@/lib/creative/motion";
import { planMotionGeneration, totalOf, type MotionLine } from "@/lib/creative/motion-gen";

/** Higgsfield key from HF_CREDENTIALS ("KEY_ID:KEY_SECRET", the SDK's format) or the two separate variables. */
const creds = () => {
  const [id, ...rest] = (process.env.HF_CREDENTIALS ?? "").split(":");
  if (id && rest.length) return { keyId: id, secret: rest.join(":") };
  return { keyId: process.env.HIGGSFIELD_API_KEY_ID ?? "", secret: process.env.HIGGSFIELD_API_KEY_SECRET ?? "" };
};
export const generationConfigured = () => Boolean(creds().keyId && creds().secret);
const MAX_SUBMIT_ATTEMPTS = 5;

export type BatchLine = { itemId: string; model: ModelRow; spec: ReturnType<typeof ProductionSpec.parse>; estimate: number };

/** Server-side quote for a batch of approved items with prepared specs. Never trusts a client price. */
export async function quoteBatch(workspaceId: string, itemIds: string[]): Promise<{ lines: BatchLine[]; total: number; problems: string[] }> {
  const db = supabaseAdmin();
  const { data: items } = await db.from("content_items").select("id,status,spec,spec_model_id").eq("workspace_id", workspaceId).in("id", itemIds);
  const modelIds = [...new Set((items ?? []).map((i) => i.spec_model_id).filter(Boolean))];
  const { data: models } = modelIds.length ? await db.from("provider_models").select("*").in("id", modelIds) : { data: [] };
  const byId = new Map((models ?? []).map((m) => [m.id, { ...m, usd_per_unit: Number(m.usd_per_unit) } as ModelRow]));
  const lines: BatchLine[] = [], problems: string[] = [];
  for (const id of itemIds) {
    const it = (items ?? []).find((x) => x.id === id);
    if (!it) { problems.push("An item isn't in this business."); continue; }
    if (!["approved", "generated", "failed"].includes(it.status)) { problems.push("Only approved items can be generated."); continue; }
    const model = it.spec_model_id ? byId.get(it.spec_model_id) : undefined;
    const spec = ProductionSpec.safeParse(it.spec);
    if (!model || !model.enabled) { problems.push("An item's model is not enabled by an admin."); continue; }
    if (!spec.success) { problems.push("An item has no valid production spec yet."); continue; }
    lines.push({ itemId: id, model, spec: spec.data, estimate: estimateCost(model, spec.data) });
  }
  return { lines, total: Math.round(lines.reduce((s, l) => s + l.estimate, 0) * 1e6) / 1e6, problems };
}

/**
 * The owner's explicit "generate these for $X" click. Re-quotes on the server, refuses if the price changed,
 * enforces batch/concurrency limits, holds money + generation counts for every job, then records each job.
 * The idempotency key is tied to the item version and spec, so the same approval can never be charged twice.
 */
export async function authorizeBatch(a: { workspaceId: string; brandId: string; userId: string; itemIds: string[]; confirmedTotal: number }) {
  if (!generationConfigured()) throw new QuotaError("NOT_CONFIGURED", "Image and video generation isn't connected yet: a Dall AI admin needs to add the Higgsfield API key.");
  const db = supabaseAdmin();
  const q = await quoteBatch(a.workspaceId, a.itemIds);
  if (q.problems.length) throw new QuotaError("INVALID", q.problems[0]);
  if (!q.lines.length) throw new QuotaError("INVALID", "Nothing to generate.");
  if (Math.abs(q.total - a.confirmedTotal) > 0.000001) throw new QuotaError("PRICE_CHANGED", `The estimate changed to $${q.total.toFixed(4)}. Review it and confirm again.`);

  await checkLimits(a, q.lines.length);

  const created: string[] = [];
  for (const l of q.lines) {
    const { data: item } = await db.from("content_items").select("version").eq("id", l.itemId).single();
    const key = `gen:${l.itemId}:v${item!.version}:${createHash("sha256").update(JSON.stringify(l.spec) + l.model.id).digest("hex").slice(0, 24)}`;
    const { data: existing } = await db.from("generation_jobs").select("id").eq("idempotency_key", key).maybeSingle();
    if (existing) continue; // already authorized: never charge the same approval twice
    const resMoney = await reserve({ workspaceId: a.workspaceId, brandId: a.brandId, userId: a.userId, resource: "media_usd", amount: l.estimate, jobRef: key });
    try {
      await reserve({ workspaceId: a.workspaceId, brandId: a.brandId, userId: a.userId, resource: l.model.kind === "video" ? "video_generations" : "image_generations", amount: l.spec.variations, jobRef: key });
    } catch (e) { await settle(resMoney, 0, "higgsfield", l.model.endpoint); throw e; }
    let refs: string[] = [];
    if (l.model.image_param && l.spec.reference_asset_paths.length) {
      const { data: signed } = await db.storage.from("creative-assets").createSignedUrls(l.spec.reference_asset_paths, 60 * 60 * 24);
      refs = (signed ?? []).map((x) => x.signedUrl).filter(Boolean) as string[];
    }
    const { data: job, error } = await db.from("generation_jobs").insert({
      workspace_id: a.workspaceId, brand_id: a.brandId, item_id: l.itemId, model_id: l.model.id, spec: l.spec,
      input: providerInput(l.model, l.spec, refs), idempotency_key: key, est_cost_usd: l.estimate, reservation_id: resMoney, authorized_by: a.userId,
    }).select("id").single();
    if (error) { await settle(resMoney, 0, "higgsfield", l.model.endpoint); throw new Error(error.message); }
    await db.from("content_items").update({ status: "generation_queued", updated_at: new Date().toISOString() }).eq("id", l.itemId);
    await db.from("approval_events").insert({ workspace_id: a.workspaceId, entity: "generation", entity_id: job!.id, action: "authorize_generation", actor: a.userId, details: { item_id: l.itemId, model: l.model.endpoint, estimate_usd: l.estimate } });
    created.push(job!.id);
  }
  return created;
}

/** Batch size and concurrency limits from the admin's quota policies (platform, plan, org, brand, user). */
async function checkLimits(a: { workspaceId: string; brandId: string; userId: string }, n: number) {
  const db = supabaseAdmin();
  const { data: pols } = await db.from("quota_policies").select("scope,scope_id,max_batch,max_concurrent").eq("resource", "media_usd").eq("enabled", true);
  const { data: sub } = await db.from("platform_subscriptions").select("plan_id").eq("workspace_id", a.workspaceId).maybeSingle();
  const applies = (p: { scope: string; scope_id: string | null }) => p.scope === "platform" || (p.scope === "plan" && p.scope_id === sub?.plan_id) || (p.scope === "org" && p.scope_id === a.workspaceId) || (p.scope === "brand" && p.scope_id === a.brandId) || (p.scope === "user" && p.scope_id === a.userId);
  const maxBatch = Math.min(...(pols ?? []).filter(applies).map((p) => p.max_batch ?? Infinity), 20);
  const maxConc = Math.min(...(pols ?? []).filter(applies).map((p) => p.max_concurrent ?? Infinity), 10);
  if (n > maxBatch) throw new QuotaError("BATCH", `You can generate up to ${maxBatch} items at once.`);
  const { count: running } = await db.from("generation_jobs").select("id", { count: "exact", head: true }).eq("workspace_id", a.workspaceId).in("status", ["authorized", "submitting", "queued", "in_progress", "uncertain"]);
  if ((running ?? 0) + n > maxConc) throw new QuotaError("CONCURRENCY", `Only ${maxConc} generations can run at once; ${running ?? 0} are running.`);
}

/** Server-side quote for an APPROVED motion plan: every edit and scene with its model and price. */
export async function quoteMotion(workspaceId: string, projectId: string): Promise<{ project: { id: string; brand_id: string; version: number } | null; lines: MotionLine[]; total: number; problems: string[] }> {
  const db = supabaseAdmin();
  const { data: proj } = await db.from("motion_projects").select("id,brand_id,version,status,pack").eq("id", projectId).eq("workspace_id", workspaceId).maybeSingle();
  if (!proj) return { project: null, lines: [], total: 0, problems: ["That motion plan isn't in this business."] };
  if (proj.status !== "approved") return { project: proj, lines: [], total: 0, problems: ["Approve the plan before making it."] };
  const pack = MotionPack.safeParse(proj.pack);
  if (!pack.success) return { project: proj, lines: [], total: 0, problems: ["The plan is in an old format. Write the storyboard again."] };
  const { data: models } = await db.from("provider_models").select("*").eq("enabled", true);
  const { lines, problems } = planMotionGeneration(pack.data, (models ?? []).map((m) => ({ ...m, usd_per_unit: Number(m.usd_per_unit) }) as ModelRow));
  return { project: proj, lines, total: totalOf(lines), problems };
}

/**
 * The owner's "make these for $X" click on a motion plan. Re-quotes on the server, refuses a changed
 * price, enforces limits, holds budget per job and records each job. Keys are tied to the plan version
 * and spec, so the same approval is never charged twice. Jobs then run through the normal poller.
 */
export async function authorizeMotion(a: { workspaceId: string; brandId: string; userId: string; projectId: string; keys: string[]; confirmedTotal: number }): Promise<string[]> {
  if (!generationConfigured()) throw new QuotaError("NOT_CONFIGURED", "Image and video generation isn't connected yet: a Dall AI admin needs to add the Higgsfield API key.");
  const db = supabaseAdmin();
  const q = await quoteMotion(a.workspaceId, a.projectId);
  if (!q.project || q.project.brand_id !== a.brandId) throw new QuotaError("INVALID", q.problems[0] ?? "That motion plan isn't in this brand.");
  const lines = q.lines.filter((l) => a.keys.includes(l.key));
  if (!lines.length) throw new QuotaError("INVALID", q.problems[0] ?? "Pick at least one scene or edit to make.");
  const total = totalOf(lines);
  if (Math.abs(total - a.confirmedTotal) > 0.000001) throw new QuotaError("PRICE_CHANGED", `The estimate changed to $${total.toFixed(4)}. Review it and confirm again.`);
  await checkLimits(a, lines.length);

  const created: string[] = [];
  for (const l of lines) {
    const key = `motion:${a.projectId}:v${q.project.version}:${l.key}:${createHash("sha256").update(JSON.stringify(l.spec) + l.model.id).digest("hex").slice(0, 24)}`;
    const { data: existing } = await db.from("generation_jobs").select("id").eq("idempotency_key", key).maybeSingle();
    if (existing) continue;
    const resMoney = await reserve({ workspaceId: a.workspaceId, brandId: a.brandId, userId: a.userId, resource: "media_usd", amount: l.estimate, jobRef: key });
    try {
      await reserve({ workspaceId: a.workspaceId, brandId: a.brandId, userId: a.userId, resource: l.model.kind === "video" ? "video_generations" : "image_generations", amount: 1, jobRef: key });
    } catch (e) { await settle(resMoney, 0, "higgsfield", l.model.endpoint); throw e; }
    let refs: string[] = [];
    if (l.model.image_param && l.spec.reference_asset_paths.length) {
      const { data: signed } = await db.storage.from("creative-assets").createSignedUrls(l.spec.reference_asset_paths, 60 * 60 * 24);
      refs = (signed ?? []).map((x) => x.signedUrl).filter(Boolean) as string[];
    }
    const { data: job, error } = await db.from("generation_jobs").insert({
      workspace_id: a.workspaceId, brand_id: a.brandId, item_id: null, motion_project_id: a.projectId, scene_key: l.key, model_id: l.model.id, spec: l.spec,
      input: providerInput(l.model, l.spec, refs), idempotency_key: key, est_cost_usd: l.estimate, reservation_id: resMoney, authorized_by: a.userId,
    }).select("id").single();
    if (error) { await settle(resMoney, 0, "higgsfield", l.model.endpoint); throw new Error(error.message); }
    await db.from("approval_events").insert({ workspace_id: a.workspaceId, entity: "generation", entity_id: job!.id, action: "authorize_generation", actor: a.userId, details: { motion_project_id: a.projectId, scene: l.key, model: l.model.endpoint, estimate_usd: l.estimate } });
    created.push(job!.id);
  }
  return created;
}

async function holdsFor(key: string) {
  const { data } = await supabaseAdmin().from("budget_reservations").select("id,resource,amount").eq("job_ref", key).eq("status", "held");
  return data ?? [];
}
async function closeHolds(key: string, charged: boolean, model: string) {
  for (const h of await holdsFor(key)) await settle(h.id, charged ? Number(h.amount) : 0, "higgsfield", model, "estimate");
}

/** Submits (or safely re-submits with the same idempotency key) one authorized/uncertain job. */
export async function submitJob(jobId: string): Promise<void> {
  const db = supabaseAdmin();
  const { data: job } = await db.from("generation_jobs").select("*, provider_models(endpoint)").eq("id", jobId).single();
  if (!job || !["authorized", "uncertain"].includes(job.status)) return;
  const { data: claimed } = await db.from("generation_jobs").update({ status: "submitting", attempts: job.attempts + 1 }).eq("id", jobId).eq("status", job.status).select("id");
  if (!claimed?.length) return; // another worker took it
  const endpoint = (job.provider_models as { endpoint: string }).endpoint;
  const hook = process.env.HIGGSFIELD_WEBHOOK_SECRET ? `${serverEnv.siteUrl()}/api/webhooks/higgsfield` : undefined;
  try {
    const r = await hfSubmit({ ...creds(), endpoint, input: job.input, idempotencyKey: job.idempotency_key, webhookUrl: hook });
    await db.from("generation_jobs").update({ status: jobStatusFrom(r.status) ?? "queued", provider_request_id: r.request_id, status_url: r.status_url ?? null, submitted_at: new Date().toISOString(), error: null }).eq("id", jobId);
    if (job.item_id) await db.from("content_items").update({ status: "generating" }).eq("id", job.item_id);
  } catch (e) {
    const err = e as HfError;
    if (err.ambiguous && job.attempts + 1 < MAX_SUBMIT_ATTEMPTS) {
      // Might have been accepted: keep the hold, retry later with the SAME key (no duplicate charge).
      await db.from("generation_jobs").update({ status: "uncertain", error: err.message.slice(0, 400) }).eq("id", jobId);
    } else if (err.ambiguous) {
      await db.from("generation_jobs").update({ status: "uncertain", error: `Still unconfirmed after ${MAX_SUBMIT_ATTEMPTS} tries: ${err.message}`.slice(0, 400) }).eq("id", jobId);
    } else {
      // Clearly rejected (4xx): nothing was charged, release the budget.
      await db.from("generation_jobs").update({ status: "failed", error: err.message.slice(0, 400), finished_at: new Date().toISOString() }).eq("id", jobId);
      if (job.item_id) await db.from("content_items").update({ status: "failed" }).eq("id", job.item_id);
      await closeHolds(job.idempotency_key, false, endpoint);
    }
  }
}

/** Applies a provider status (from polling or a verified webhook) to a job, storing outputs on completion. */
export async function applyProviderStatus(jobId: string, s: { status: string; error?: string | null; images?: { url: string; content_type?: string }[]; video?: { url: string; content_type?: string } }) {
  const db = supabaseAdmin();
  const { data: job } = await db.from("generation_jobs").select("*, provider_models(endpoint,kind)").eq("id", jobId).single();
  if (!job || ["stored", "failed", "nsfw", "canceled"].includes(job.status)) return;
  const status = jobStatusFrom(s.status);
  const endpoint = (job.provider_models as { endpoint: string }).endpoint;
  if (status === "queued" || status === "in_progress") { await db.from("generation_jobs").update({ status }).eq("id", jobId); return; }
  if (status && NOT_CHARGED.has(status)) {
    await db.from("generation_jobs").update({ status, error: s.error ?? (status === "nsfw" ? "Blocked by the provider's content moderation." : null), finished_at: new Date().toISOString() }).eq("id", jobId);
    if (job.item_id) await db.from("content_items").update({ status: "failed" }).eq("id", job.item_id);
    await closeHolds(job.idempotency_key, false, endpoint);
    return;
  }
  if (status !== "completed") return;
  await db.from("generation_jobs").update({ status: "completed", finished_at: new Date().toISOString() }).eq("id", jobId);
  // Copy outputs into our own storage now: provider URLs expire after 7 days.
  const outs = hfOutputs(s);
  const paths: string[] = [];
  for (const [i, o] of outs.entries()) {
    const res = await fetch(o.url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Couldn't download output ${i + 1} (${res.status}).`);
    const type = o.contentType || res.headers.get("content-type") || "application/octet-stream";
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : type.includes("mp4") ? "mp4" : type.includes("jpeg") || type.includes("jpg") ? "jpg" : "bin";
    const path = `${job.workspace_id}/${job.brand_id}/${job.id}/${i + 1}.${ext}`;
    const up = await db.storage.from("creative-assets").upload(path, buf, { contentType: type, upsert: true });
    if (up.error) throw new Error(`Storage upload failed: ${up.error.message}`);
    paths.push(path);
    await db.from("creative_assets").insert({ workspace_id: job.workspace_id, brand_id: job.brand_id, item_id: job.item_id, motion_project_id: job.motion_project_id ?? null, job_id: job.id, path, kind: (job.provider_models as { kind: string }).kind, content_type: type, bytes: buf.length });
  }
  if (!paths.length) throw new Error("The provider reported success but returned no files.");
  // Verified and stored: only now is the item ready, and the (priced) cost booked.
  await db.from("generation_jobs").update({ status: "stored", output_paths: paths, actual_cost_usd: job.est_cost_usd }).eq("id", jobId);
  if (job.item_id) await db.from("content_items").update({ status: "generated", updated_at: new Date().toISOString() }).eq("id", job.item_id);
  await closeHolds(job.idempotency_key, true, endpoint);
}

/** Background pass: submits authorized/uncertain jobs, polls running ones, retries unstored outputs. */
export async function pollCreativeJobs(budgetMs = 15_000): Promise<{ submitted: number; polled: number; errors: number }> {
  const db = supabaseAdmin();
  const started = Date.now();
  const tally = { submitted: 0, polled: 0, errors: 0 };
  if (!generationConfigured()) return tally;
  const { data: jobs } = await db.from("generation_jobs").select("id,status,provider_request_id,status_url").in("status", ["authorized", "uncertain", "queued", "in_progress", "completed"]).order("created_at").limit(25);
  for (const j of jobs ?? []) {
    if (Date.now() - started > budgetMs) break;
    try {
      if (j.status === "authorized" || j.status === "uncertain") { await submitJob(j.id); tally.submitted++; continue; }
      if (!j.provider_request_id) continue;
      const s = await hfStatus({ ...creds(), requestId: j.provider_request_id, statusUrl: j.status_url });
      await applyProviderStatus(j.id, s);
      tally.polled++;
    } catch (e) {
      tally.errors++;
      await db.from("generation_jobs").update({ error: (e as Error).message.slice(0, 400) }).eq("id", j.id);
    }
  }
  return tally;
}
