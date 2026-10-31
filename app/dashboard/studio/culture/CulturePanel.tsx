import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ResearchResult, STAGES } from "@/lib/culture/schemas";
import { startCultureResearch, retryCultureResearch } from "./actions";

// Creative Studio · Cultural Research. Owners ask for research; the cultural intelligence agents work
// through the stages below and return insights with sources plus advertising angles for this business.

type Row = { id: string; topic: string; region: string; depth: string; status: string; stage: string; result: unknown; error: string | null; searches_used: number; created_at: string; finished_at: string | null };
type Extra = { memory_used?: string[]; sent_for_review?: number; sources?: { url: string; title: string | null; page_age: string | null; host: string | null }[] };

const EXAMPLES = [
  "Funny Lagos relationship situations that could sell our couples' dinner package",
  "Everyday Lagos traffic and transport moments people joke about",
  "What Nigerians say and do around salary week and 'japa'",
];

export default async function CulturePanel({ B, ws, sp }: { B: string; ws: string; sp: Record<string, string | undefined> }) {
  const { data, error } = await supabaseAdmin().from("ci_research_tasks")
    .select("id,topic,region,depth,status,stage,result,error,searches_used,created_at,finished_at")
    .eq("workspace_id", ws).order("created_at", { ascending: false }).limit(8);
  if (error) return <section className="panel"><h2>Cultural Research</h2><p className="muted">Cultural Research is being set up. Check back shortly.</p></section>;
  const tasks = (data ?? []) as Row[];
  const open = tasks.find((t) => t.id === sp.task) ?? tasks[0];
  const busy = tasks.some((t) => t.status === "queued" || t.status === "running");

  return (
    <>
      <section className="panel">
        <div className="row between"><h2>Cultural Research</h2><span className="muted">Creative Studio</span></div>
        <p className="muted">Find Nigerian stories, expressions and everyday situations your customers recognise, and how they could sell what you offer. Your products, prices and offers come from your account automatically.</p>
        <form action={startCultureResearch} className="cd-form">
          <input type="hidden" name="b" value={B} />
          <label className="field"><span>What should we research?</span>
            <textarea name="topic" className="input" rows={3} required minLength={8} maxLength={600} placeholder={EXAMPLES[0]} />
          </label>
          <div className="grid3">
            <label className="field"><span>Depth</span><select name="depth" className="input" defaultValue="standard">
              <option value="quick">Quick: use what Dall AI already knows</option>
              <option value="standard">Standard: check current sources (≈6 searches)</option>
              <option value="deep">Deep: investigate first (≈14 searches)</option>
            </select></label>
            <label className="field"><span>Region</span><input name="region" className="input" defaultValue="Lagos" maxLength={80} /></label>
          </div>
          <p className="muted">We search public Nigerian blogs, news, culture and comedy sites. We never collect from Instagram, Facebook or TikTok, and we never copy anyone's posts or jokes.</p>
          <button className="btn btn-lime" disabled={busy}>{busy ? "Researching…" : "Start research"}</button>
        </form>
      </section>

      {open && <TaskView B={B} t={open} />}

      {tasks.length > 1 && (
        <section className="panel">
          <h3>Earlier research</h3>
          <ul className="ci-list">{tasks.map((t) => (
            <li key={t.id}><Link href={`/dashboard/studio?b=${B}&tab=culture&task=${t.id}`} aria-current={t.id === open?.id ? "page" : undefined}>{t.topic}</Link> <small className="muted">{t.status} · {new Date(t.created_at).toLocaleDateString("en-NG", { dateStyle: "medium" })}</small></li>
          ))}</ul>
        </section>
      )}
    </>
  );
}

function TaskView({ B, t }: { B: string; t: Row }) {
  if (t.status === "queued" || t.status === "running") {
    const at = STAGES.findIndex(([k]) => k === t.stage);
    return (
      <section className="panel" aria-live="polite">
        <h3>{t.topic}</h3>
        <ol className="ci-stages">{STAGES.map(([k, label], i) => <li key={k} className={i < at ? "done" : i === at ? "now" : ""}>{label}</li>)}</ol>
        <p className="muted">Usually 1–3 minutes. <Link href={`/dashboard/studio?b=${B}&tab=culture&task=${t.id}`}>Refresh</Link> to see progress.</p>
      </section>
    );
  }
  if (t.status === "failed") {
    return (
      <section className="panel">
        <h3>{t.topic}</h3>
        <div className="notice notice-bad">{t.error ?? "Research failed."}
          <form action={retryCultureResearch} style={{ display: "inline", marginLeft: 8 }}><input type="hidden" name="b" value={B} /><input type="hidden" name="task" value={t.id} /><button className="btn btn-line btn-sm">Retry</button></form>
        </div>
      </section>
    );
  }
  const parsed = ResearchResult.safeParse(t.result);
  if (!parsed.success) return <section className="panel"><h3>{t.topic}</h3><p>Result unreadable.</p></section>;
  const r = parsed.data, x = (t.result ?? {}) as Extra;
  return (
    <section className="panel report">
      <h3>{t.topic}</h3>
      <p className="muted">{t.region} · {t.depth} · {t.searches_used} searches{t.finished_at ? ` · ${new Date(t.finished_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}` : ""}</p>
      {r.summary && <p>{r.summary}</p>}

      {r.opportunities.length > 0 && <>
        <h3>Advertising opportunities for you</h3>
        <div className="ci-cards">{r.opportunities.map((o) => (
          <article key={o.title} className="ci-card">
            <b>{o.title}</b>
            <p>{o.angle}</p>
            <small className="muted">{[o.product && `Product: ${o.product}`, o.format && `Format: ${o.format}`, o.uses.length ? `Builds on: ${o.uses.join(", ")}` : ""].filter(Boolean).join(" · ")}</small>
            {o.risk && <small className="hyp">Watch out: {o.risk}</small>}
          </article>
        ))}</div>
      </>}

      <h3>Cultural insights</h3>
      <ul>{r.insights.map((i) => (
        <li key={i.title} style={{ marginBottom: 8 }}>
          <b>{i.title}</b> <span className={`conf conf-${i.confidence}`}>{i.confidence} confidence</span> <small className="muted">{i.kind} · {i.lifespan}{i.region ? ` · ${i.region}` : ""}</small><br />
          {i.meaning}
          {i.why_relatable && <><br /><small>Why it lands: {i.why_relatable}</small></>}
          {i.audience && <><br /><small className="muted">Who gets it: {i.audience}</small></>}
          {i.usage_note && <><br /><small className="hyp">{i.usage_note}</small></>}
          <br />{i.sources.length ? <span className="srcs">{i.sources.map((s, n) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" title={s.excerpt}>[{n + 1}]</a>)}</span> : <span className="hyp">Hypothesis (no source)</span>}
        </li>
      ))}</ul>

      {(x.memory_used?.length ?? 0) > 0 && <p className="muted">Also drew on Dall AI's reviewed cultural memory: {x.memory_used!.join(", ")}.</p>}
      {r.limitations.length > 0 && <ul className="muted">{r.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      {(x.sources?.length ?? 0) > 0 && <details><summary>Sources checked ({x.sources!.length})</summary><ol className="srclist">{x.sources!.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title ?? s.url}</a> <small>{s.host}{s.page_age ? ` · ${s.page_age}` : ""}</small></li>)}</ol></details>}
      <p className="muted">Campaign Concepts and Content Production are coming next in Creative Studio.</p>
    </section>
  );
}
