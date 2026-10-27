import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { supabaseUser, supabaseAdmin } from "@/lib/supabase/server";
import { generationConfigured } from "@/lib/creative/jobs";
import "../../dashboard/dashboard.css";

export const metadata = { title: "Creative Director admin", robots: { index: false } };

async function requireAdmin() {
  const db = await supabaseUser();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login?next=/admin/creative");
  const { data } = await supabaseAdmin().from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!data) notFound();
  return user;
}

const RESOURCES = ["claude_usd", "claude_tokens", "research_requests", "image_generations", "video_generations", "media_usd"] as const;
const SCOPES = ["platform", "plan", "org", "brand", "user"] as const;
const PARAMS = ["prompt", "negative_prompt", "aspect_ratio", "duration", "resolution", "num_images"];

async function saveModel(formData: FormData) {
  "use server";
  const u = await requireAdmin();
  const endpoint = String(formData.get("endpoint") ?? "").trim().replace(/^\/+/, "");
  const price = Number(formData.get("usd_per_unit"));
  if (!/^[a-z0-9][a-z0-9._\-/]*$/i.test(endpoint) || !(price > 0)) redirect("/admin/creative?error=model");
  await supabaseAdmin().from("provider_models").upsert({
    provider: "higgsfield", endpoint, name: String(formData.get("name") ?? endpoint).slice(0, 80),
    kind: formData.get("kind") === "video" ? "video" : "image", unit: formData.get("kind") === "video" ? "second" : "image",
    usd_per_unit: price, max_seconds: Number(formData.get("max_seconds")) || null,
    allowed_params: formData.getAll("allowed_params").map(String).filter((p) => PARAMS.includes(p)).concat("prompt").filter((v, i, a) => a.indexOf(v) === i),
    enabled: formData.get("enabled") === "on", updated_at: new Date().toISOString(),
  }, { onConflict: "provider,endpoint" });
  await supabaseAdmin().from("billing_audit_logs").insert({ actor_id: u.id, action: "creative.model_saved", details: { endpoint, price } });
  revalidatePath("/admin/creative");
  redirect("/admin/creative?saved=1");
}

async function savePolicy(formData: FormData) {
  "use server";
  const u = await requireAdmin();
  const scope = String(formData.get("scope"));
  const resource = String(formData.get("resource"));
  const period = formData.get("period") === "day" ? "day" : "month";
  const limit = Number(formData.get("limit_amount"));
  const scopeId = scope === "platform" ? null : String(formData.get("scope_id") ?? "").trim() || null;
  if (!SCOPES.includes(scope as never) || !RESOURCES.includes(resource as never) || !(limit >= 0) || (scope !== "platform" && !scopeId)) redirect("/admin/creative?error=policy");
  await supabaseAdmin().from("quota_policies").upsert({
    scope, scope_id: scopeId, resource, period, limit_amount: limit,
    max_batch: Number(formData.get("max_batch")) || null, max_concurrent: Number(formData.get("max_concurrent")) || null,
    enabled: formData.get("enabled") !== "off", updated_by: u.id, updated_at: new Date().toISOString(),
  }, { onConflict: "scope,scope_id,resource,period" });
  await supabaseAdmin().from("billing_audit_logs").insert({ actor_id: u.id, action: "creative.quota_saved", details: { scope, scopeId, resource, period, limit } });
  revalidatePath("/admin/creative");
  redirect("/admin/creative?saved=1");
}

export default async function CreativeAdmin({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const db = supabaseAdmin();
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const [{ data: models }, { data: pols }, { data: ledger }, { data: jobs }] = await Promise.all([
    db.from("provider_models").select("*").order("kind"),
    db.from("quota_policies").select("*").order("scope"),
    db.from("usage_ledger").select("workspace_id,resource,amount,basis").eq("kind", "charge").gte("created_at", monthStart).limit(10000),
    db.from("generation_jobs").select("status").gte("created_at", monthStart),
  ]);
  const total = (r: string) => (ledger ?? []).filter((l) => l.resource === r).reduce((s, l) => s + Number(l.amount), 0);
  const mediaCap = (pols ?? []).find((p) => p.scope === "platform" && p.resource === "media_usd" && p.enabled);
  return (
    <div className="main" style={{ maxWidth: 1200, margin: "0 auto" }}>
      <div className="page-head"><div><h1>Creative Director admin</h1><p>Models, prices and limits. Changes apply immediately, no deploy needed.</p></div><Link href="/admin">← Platform admin</Link></div>
      {sp.error && <div className="notice notice-bad">{sp.error === "model" ? "Enter the model's Higgsfield path and a price above 0." : "Pick a scope, a resource and a limit; non-platform scopes need an id."}</div>}
      {sp.saved && <div className="notice notice-ok">Saved.</div>}
      <div className="stats">
        <div className={`stat${generationConfigured() ? "" : " attn"}`}><span>Higgsfield API key</span><b>{generationConfigured() ? "Set" : "Missing"}</b></div>
        <div className={`stat${mediaCap ? "" : " attn"}`}><span>Platform media cap</span><b>{mediaCap ? `$${Number(mediaCap.limit_amount)}/${mediaCap.period}` : "Not set: generation off"}</b></div>
        <div className="stat"><span>Claude spend this month</span><b>${total("claude_usd").toFixed(2)}</b></div>
        <div className="stat"><span>Media spend this month (est.)</span><b>${total("media_usd").toFixed(2)}</b></div>
        <div className="stat"><span>Jobs this month</span><b>{(jobs ?? []).length}</b><small>{(jobs ?? []).filter((j) => ["failed", "nsfw", "uncertain"].includes(j.status)).length} failed/uncertain</small></div>
      </div>

      <section className="panel">
        <h2>Generation models (Higgsfield)</h2>
        <p className="muted">Copy the model path and current price from your Higgsfield console (each model has its own endpoint and parameters). Only enabled models can be used, and only the parameters you tick are sent.</p>
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>Endpoint</th><th>Kind</th><th className="num">Price</th><th>Params</th><th>Enabled</th></tr></thead><tbody>
          {(models ?? []).map((m) => <tr key={m.id}><td>{m.name}</td><td className="mono">{m.endpoint}</td><td>{m.kind}</td><td className="num">${Number(m.usd_per_unit)}/{m.unit}</td><td><small>{(m.allowed_params as string[]).join(", ")}</small></td><td>{m.enabled ? "Yes" : "No"}</td></tr>)}
        </tbody></table></div>
        <form action={saveModel} style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", marginTop: 10 }}>
          <label className="field"><span>Name</span><input name="name" className="input" placeholder="Soul 2 (image)" /></label>
          <label className="field"><span>Endpoint path</span><input name="endpoint" className="input mono" placeholder="higgsfield-ai/soul/v2/standard" required /></label>
          <label className="field"><span>Kind</span><select name="kind" className="input"><option value="image">Image (priced per image)</option><option value="video">Video (priced per second)</option></select></label>
          <label className="field"><span>USD per unit</span><input name="usd_per_unit" type="number" step="0.000001" min="0" className="input" required /></label>
          <label className="field"><span>Max seconds (video)</span><input name="max_seconds" type="number" min={1} className="input" /></label>
          <fieldset style={{ border: 0, padding: 0, fontSize: 13 }}><legend>Parameters this model accepts</legend>{PARAMS.map((p) => <label key={p} style={{ display: "block" }}><input type="checkbox" name="allowed_params" value={p} defaultChecked={p === "prompt"} /> {p}</label>)}</fieldset>
          <label style={{ alignSelf: "end" }}><input type="checkbox" name="enabled" /> Enabled</label>
          <div style={{ alignSelf: "end" }}><button className="btn btn-ink">Save model</button></div>
        </form>
      </section>

      <section className="panel">
        <h2>Quotas and spend caps</h2>
        <p className="muted">Every applicable limit must have room: platform, plan, business (org = workspace id), brand and user. Paid media generation stays off until a <b>platform media_usd</b> cap exists.</p>
        <div className="table-wrap"><table><thead><tr><th>Scope</th><th>Id</th><th>Resource</th><th>Period</th><th className="num">Limit</th><th className="num">Max batch</th><th className="num">Max concurrent</th><th>On</th></tr></thead><tbody>
          {(pols ?? []).map((p) => <tr key={p.id}><td>{p.scope}</td><td className="mono"><small>{p.scope_id ?? "—"}</small></td><td>{p.resource}</td><td>{p.period}</td><td className="num">{Number(p.limit_amount)}</td><td className="num">{p.max_batch ?? "—"}</td><td className="num">{p.max_concurrent ?? "—"}</td><td>{p.enabled ? "Yes" : "No"}</td></tr>)}
        </tbody></table></div>
        <form action={savePolicy} style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", marginTop: 10 }}>
          <label className="field"><span>Scope</span><select name="scope" className="input">{SCOPES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="field"><span>Scope id</span><input name="scope_id" className="input mono" placeholder="plan id / workspace / brand / user" /></label>
          <label className="field"><span>Resource</span><select name="resource" className="input">{RESOURCES.map((r) => <option key={r}>{r}</option>)}</select></label>
          <label className="field"><span>Period</span><select name="period" className="input"><option value="month">month</option><option value="day">day</option></select></label>
          <label className="field"><span>Limit (USD or count)</span><input name="limit_amount" type="number" step="0.01" min="0" className="input" required /></label>
          <label className="field"><span>Max batch</span><input name="max_batch" type="number" min={1} className="input" /></label>
          <label className="field"><span>Max concurrent</span><input name="max_concurrent" type="number" min={1} className="input" /></label>
          <label className="field"><span>State</span><select name="enabled" className="input"><option value="on">Enabled</option><option value="off">Disabled</option></select></label>
          <div style={{ alignSelf: "end" }}><button className="btn btn-ink">Save limit</button></div>
        </form>
      </section>
    </div>
  );
}
