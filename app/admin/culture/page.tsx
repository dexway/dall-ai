import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { supabaseUser, supabaseAdmin } from "@/lib/supabase/server";
import { hostOf } from "@/lib/culture/schemas";
import "../../dashboard/dashboard.css";

export const metadata = { title: "Cultural intelligence admin", robots: { index: false } };

// Platform admins review what the research agents found before it becomes trusted shared knowledge,
// and manage which sources research may use. Nothing here is visible to businesses.

async function requireAdmin() {
  const db = await supabaseUser();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login?next=/admin/culture");
  const { data } = await supabaseAdmin().from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!data) notFound();
  return user;
}

async function review(formData: FormData) {
  "use server";
  const u = await requireAdmin();
  const db = supabaseAdmin();
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision"));
  const note = String(formData.get("note") ?? "").trim().slice(0, 300) || null;
  const { data: k } = await db.from("ci_knowledge").select("id,key,status").eq("id", id).maybeSingle();
  if (!k) redirect("/admin/culture?error=1");
  const now = new Date().toISOString();
  if (decision === "approve" && k.status === "pending_review") {
    // Older trusted versions of the same key are retired and point at this one.
    await db.from("ci_knowledge").update({ status: "retired", superseded_by: k.id }).eq("key", k.key).eq("status", "trusted");
    await db.from("ci_knowledge").update({ status: "trusted", reviewed_by: u.id, reviewed_at: now, review_note: note, last_verified_at: now }).eq("id", k.id);
  } else if (decision === "reject" && k.status === "pending_review") {
    await db.from("ci_knowledge").update({ status: "rejected", reviewed_by: u.id, reviewed_at: now, review_note: note }).eq("id", k.id);
  } else if (decision === "retire" && k.status === "trusted") {
    await db.from("ci_knowledge").update({ status: "retired", reviewed_by: u.id, reviewed_at: now, review_note: note }).eq("id", k.id);
  }
  await db.from("billing_audit_logs").insert({ actor_id: u.id, action: `culture.knowledge_${decision}`, details: { id, key: k.key } });
  revalidatePath("/admin/culture");
  redirect("/admin/culture?saved=1");
}

async function saveSource(formData: FormData) {
  "use server";
  const u = await requireAdmin();
  const domain = hostOf(/^https?:\/\//.test(String(formData.get("domain"))) ? String(formData.get("domain")) : `https://${String(formData.get("domain") ?? "").trim()}`);
  const kinds = ["blog", "news", "forum", "comedy", "reference", "api", "other"];
  const kind = kinds.includes(String(formData.get("kind"))) ? String(formData.get("kind")) : "other";
  if (!domain || !domain.includes(".")) redirect("/admin/culture?error=1");
  await supabaseAdmin().from("ci_sources").upsert({ domain, kind, allowed: formData.get("allowed") !== "off", terms_note: String(formData.get("terms_note") ?? "").slice(0, 300) || null, added_by: u.id }, { onConflict: "domain" });
  revalidatePath("/admin/culture");
  redirect("/admin/culture?saved=1");
}

export default async function CultureAdmin({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; view?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const db = supabaseAdmin();
  const view = sp.view === "trusted" ? "trusted" : "pending_review";
  const [{ data: items, error }, { data: sources }, { data: tasks }, counts] = await Promise.all([
    db.from("ci_knowledge").select("*").eq("status", view).order("created_at", { ascending: false }).limit(60),
    db.from("ci_sources").select("*").order("domain"),
    db.from("ci_research_tasks").select("id,topic,status,depth,searches_used,cost_usd,created_at,error").order("created_at", { ascending: false }).limit(15),
    Promise.all(["pending_review", "trusted"].map((s) => db.from("ci_knowledge").select("id", { count: "exact", head: true }).eq("status", s))),
  ]);
  if (error) return <main className="container" style={{ padding: 24 }}><h1>Cultural intelligence</h1><p>Tables aren&apos;t set up yet (migration 0028).</p></main>;
  const ids = (items ?? []).map((i) => i.id);
  const { data: evidence } = ids.length ? await db.from("ci_findings").select("knowledge_id,source_url,source_title,page_age,excerpt").in("knowledge_id", ids) : { data: [] };
  const ev = new Map<string, NonNullable<typeof evidence>>();
  for (const e of evidence ?? []) ev.set(e.knowledge_id!, [...(ev.get(e.knowledge_id!) ?? []), e]);

  return (
    <main className="container" style={{ padding: "24px 16px", maxWidth: 1100 }}>
      <p><Link href="/admin">← Admin</Link></p>
      <h1>Cultural intelligence</h1>
      <p className="muted">Research agents propose knowledge; it becomes shared, trusted memory only when you approve it. Businesses never see this page or each other&apos;s research.</p>
      {sp.saved && <div className="notice notice-ok">Saved.</div>}
      {sp.error && <div className="notice notice-bad">That didn&apos;t work. Check the input.</div>}

      <nav className="cd-tabs" style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <Link href="/admin/culture" aria-current={view === "pending_review" ? "page" : undefined}>Waiting for review ({counts[0].count ?? 0})</Link>
        <Link href="/admin/culture?view=trusted" aria-current={view === "trusted" ? "page" : undefined}>Trusted ({counts[1].count ?? 0})</Link>
      </nav>

      <section className="panel">
        {(items ?? []).length === 0 && <p className="muted">Nothing here yet.</p>}
        {(items ?? []).map((k) => (
          <article key={k.id} style={{ borderBottom: "1px solid #e3e3df", padding: "12px 0" }}>
            <b>{k.title}</b> <small className="muted">v{k.version} · {k.kind} · {k.lifespan} · {k.region} · {k.confidence} confidence</small>
            <p style={{ margin: "4px 0" }}>{k.meaning}</p>
            {k.why_relatable && <small>Why it lands: {k.why_relatable}<br /></small>}
            {k.audience && <small className="muted">Audience: {k.audience}<br /></small>}
            {k.example && <small className="muted">Example: {k.example}<br /></small>}
            {k.usage_note && <small style={{ color: "#a35b00" }}>Note: {k.usage_note}<br /></small>}
            <ul style={{ margin: "4px 0" }}>{(ev.get(k.id) ?? []).map((e) => <li key={e.source_url}><a href={e.source_url} target="_blank" rel="noreferrer">{e.source_title ?? e.source_url}</a> <small className="muted">{e.page_age ?? ""} {e.excerpt}</small></li>)}</ul>
            {!(ev.get(k.id) ?? []).length && <small style={{ color: "#a35b00" }}>No source: hypothesis from the model.<br /></small>}
            <form action={review} style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              <input type="hidden" name="id" value={k.id} />
              <input name="note" className="input" placeholder="Note (optional)" style={{ maxWidth: 280 }} />
              {view === "pending_review" ? <>
                <button name="decision" value="approve" className="btn btn-lime btn-sm">Approve</button>
                <button name="decision" value="reject" className="btn btn-line btn-sm">Reject</button>
              </> : <button name="decision" value="retire" className="btn btn-line btn-sm">Retire</button>}
            </form>
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>Sources</h2>
        <p className="muted">Allowed sources are preferred by research; blocked ones are never used. Instagram, Facebook, TikTok, X and WhatsApp are always blocked.</p>
        <form action={saveSource} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input name="domain" className="input" placeholder="pulse.ng" required style={{ maxWidth: 200 }} />
          <select name="kind" className="input" style={{ maxWidth: 140 }}>{["blog", "news", "forum", "comedy", "reference", "api", "other"].map((k) => <option key={k}>{k}</option>)}</select>
          <select name="allowed" className="input" style={{ maxWidth: 120 }}><option value="on">Allowed</option><option value="off">Blocked</option></select>
          <input name="terms_note" className="input" placeholder="Terms checked / why" style={{ maxWidth: 260 }} />
          <button className="btn btn-ink btn-sm">Save</button>
        </form>
        <ul>{(sources ?? []).map((s) => <li key={s.id}><b>{s.domain}</b> <small className="muted">{s.kind} · {s.allowed ? "allowed" : "blocked"}{s.terms_note ? ` · ${s.terms_note}` : ""}</small></li>)}</ul>
      </section>

      <section className="panel">
        <h2>Recent research tasks</h2>
        <div className="table-wrap"><table><thead><tr><th>Topic</th><th>Status</th><th>Depth</th><th>Searches</th><th>Cost</th><th>When</th></tr></thead><tbody>
          {(tasks ?? []).map((t) => <tr key={t.id}><td>{t.topic}{t.error ? <><br /><small style={{ color: "#a33" }}>{t.error}</small></> : null}</td><td>{t.status}</td><td>{t.depth}</td><td>{t.searches_used}</td><td>${Number(t.cost_usd).toFixed(3)}</td><td>{new Date(t.created_at).toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" })}</td></tr>)}
        </tbody></table></div>
      </section>
    </main>
  );
}
