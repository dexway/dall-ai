"use client";
import { useMemo, useState } from "react";
import { TASKS, RECOMMENDED, type Task } from "@/lib/creative/router";
import { demoBrand, demoAccounts, demoSources, demoReport, demoStrategy, demoItems, demoJobs, demoUsage, type DemoItem } from "./demo-data";

const TABS = [["create", "Create"], ["brief", "1 · Brief"], ["accounts", "2 · Accounts"], ["research", "3 · Research"], ["strategy", "4 · Strategy"], ["calendar", "5 · Calendar"], ["production", "6 · Production"], ["usage", "Usage"]] as const;
type Tab = (typeof TABS)[number][0];
const LABEL: Record<string, string> = { draft: "Draft", awaiting_approval: "Awaiting approval", approved: "Approved", rejected: "Rejected", revision_requested: "Revision requested", generation_queued: "Generation queued", generating: "Generating", generated: "Ready for review", completed: "Completed", stored: "Stored", in_progress: "In progress", nsfw: "Blocked", running: "Running" };

const Chip = ({ s }: { s: string }) => <span className={`chip st-${s}`}>{LABEL[s] ?? s}</span>;
const Src = ({ n }: { n: number[] }) => n.length ? <span className="srcs">{n.map((i) => <a key={i} href={`#src-${i}`} title={demoSources[i - 1]?.title}>[{i}]</a>)}</span> : <span className="hyp">Hypothesis (no source)</span>;
const Conf = ({ c }: { c: string }) => <span className={`conf conf-${c}`}>{c} confidence</span>;

export default function StudioDemo() {
  const [tab, setTab] = useState<Tab>("create");
  const [step, setStep] = useState(1);
  const [items, setItems] = useState<DemoItem[]>(demoItems);
  const [accounts, setAccounts] = useState(demoAccounts);
  const [strategyStatus, setStrategyStatus] = useState(demoStrategy.status);
  const [view, setView] = useState<"month" | "week" | "list">("month");
  const [researching, setResearching] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [toast, setToast] = useState("");
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(""), 2600); };
  const setStatus = (id: string, status: string) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, status } : x)));
  const move = (id: string, d: -1 | 1) => setItems((xs) => { const i = xs.findIndex((x) => x.id === id), j = i + d; if (j < 0 || j >= xs.length) return xs; const c = [...xs]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  const ready = items.filter((i) => i.status === "approved" && i.cost !== undefined);
  const total = ready.reduce((s, i) => s + (i.cost ?? 0), 0);
  const days = useMemo(() => Array.from({ length: view === "week" ? 7 : 31 }, (_, i) => `2026-12-${String(i + 1).padStart(2, "0")}`), [view]);

  return (
    <>
      <div className="page-head">
        <div><h1>Content Creator</h1><p>Make posts, photos and videos for your business. Your Creative Director agent researches, plans and picks the best AI model for each job, and nothing is spent without your yes.</p></div>
        <div className="cd-brand"><select className="input" defaultValue="mp"><option value="mp">{demoBrand.name}</option></select></div>
      </div>
      <div className="demo-banner" role="note"><b>Preview with sample data.</b> This is how the Content Creator works. Nothing here is real research or a real charge: buttons update this preview only. It switches to your live workspace once the database setup is approved.</div>
      {toast && <div className="notice notice-ok" role="status">{toast}</div>}

      <nav className="cd-tabs" aria-label="Creative Director steps">
        {TABS.slice(0, 1).map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} aria-current={tab === k ? "page" : undefined} className="cd-tab">{l}</button>)}
        <span className="cd-group">Creative Director agent</span>
        {TABS.slice(1).map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} aria-current={tab === k ? "page" : undefined} className="cd-tab">{l}</button>)}
      </nav>

      {tab === "create" && <QuickCreate onPlan={() => setTab("brief")} flash={flash} />}

      {tab === "brief" && (
        <section className="panel">
          <div className="cd-steps"><span className={step === 1 ? "on" : ""}>A · Brand profile</span><span className={step === 2 ? "on" : ""}>B · Offers, voice & limits</span></div>
          <div className="cd-form">
            {step === 1 ? <>
              <div className="grid3">
                <label className="field"><span>Website</span><input className="input" defaultValue={demoBrand.profile.website} /></label>
                <label className="field"><span>Industry</span><input className="input" defaultValue={demoBrand.profile.industry} /></label>
                <label className="field"><span>Location</span><input className="input" defaultValue={demoBrand.profile.location} /></label>
              </div>
              <label className="field"><span>Products and services</span><textarea rows={2} className="input" defaultValue={demoBrand.profile.products} /></label>
              <label className="field"><span>Target audience</span><textarea rows={2} className="input" defaultValue={demoBrand.profile.audience} /></label>
              <label className="field"><span>Customer problems you solve</span><textarea rows={2} className="input" defaultValue={demoBrand.profile.problems} /></label>
              <fieldset className="checks"><legend>Business goals</legend>{["awareness", "engagement", "leads", "bookings", "sales", "retention"].map((o) => <label key={o}><input type="checkbox" defaultChecked={demoBrand.profile.objectives.includes(o)} /> {o}</label>)}</fieldset>
            </> : <>
              <label className="field"><span>What makes you different</span><textarea rows={2} className="input" defaultValue={demoBrand.profile.differentiators} /></label>
              <div className="grid3">
                <label className="field"><span>Voice</span><input className="input" defaultValue={demoBrand.profile.voice} /></label>
                <label className="field"><span>Language</span><input className="input" defaultValue={demoBrand.profile.language} /></label>
                <label className="field"><span>Posting frequency</span><input className="input" defaultValue={demoBrand.profile.frequency} /></label>
              </div>
              <fieldset className="checks"><legend>Platforms</legend>{["instagram", "tiktok", "facebook", "whatsapp", "youtube"].map((p) => <label key={p}><input type="checkbox" defaultChecked={demoBrand.profile.platforms.includes(p)} /> {p}</label>)}</fieldset>
              <label className="field"><span>Production limits</span><textarea rows={2} className="input" defaultValue={demoBrand.profile.restrictions} /></label>
              <label className="field"><span>Claims you must never make</span><textarea rows={2} className="input" defaultValue={demoBrand.profile.prohibited_claims} /></label>
              <p className="muted">{demoBrand.assets} brand files on record (logo, 3 product photos).</p>
            </>}
            <div className="row">
              {step === 1 ? <button type="button" className="btn btn-ink" onClick={() => setStep(2)}>Save and continue</button>
                : <><button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>← Back</button><button type="button" className="btn btn-ink" onClick={() => { flash("Brief saved."); setTab("accounts"); }}>Save brief</button></>}
            </div>
          </div>
        </section>
      )}

      {tab === "accounts" && (
        <section className="panel">
          <h2>Who should we study?</h2>
          <p className="muted"><b>Direct competitors</b> sell to the same customers as you. <b>Inspiration accounts</b> can be in any industry; we study them for craft. Public pages only.</p>
          <div className="grid2">
            {(["competitor", "inspiration"] as const).map((k) => (
              <div key={k} className="cd-card">
                <h3>{k === "competitor" ? "Direct competitors" : "Inspiration accounts"} ({accounts.filter((a) => a.kind === k && a.accepted).length})</h3>
                <ul className="acc">{accounts.filter((a) => a.kind === k).map((a) => (
                  <li key={a.handle} className={a.accepted ? "" : "sugg"}>
                    <span><b>{a.handle}</b> · {a.platform}{a.source === "suggested" && <em> suggested</em>}{a.notes && <small>{a.notes}</small>}</span>
                    <span className="row">{!a.accepted && <button className="btn btn-lime btn-sm" onClick={() => setAccounts((xs) => xs.map((x) => (x.handle === a.handle ? { ...x, accepted: true } : x)))}>Keep</button>}
                      <button className="btn btn-ghost btn-sm" onClick={() => setAccounts((xs) => xs.filter((x) => x.handle !== a.handle))}>Remove</button></span>
                  </li>))}</ul>
                <div className="row"><input className="input" placeholder="@handle or link" /><button className="btn btn-line btn-sm" onClick={() => flash("Account added.")}>Add</button></div>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12 }}><button className="btn btn-ink" onClick={() => flash("2 suggestions added. Keep the ones you want.")}>🔎 Suggest more accounts</button><small className="muted">Uses a few web searches from your allowance.</small></div>
        </section>
      )}

      {tab === "research" && (
        <section className="panel report">
          <div className="row between"><h2>Research</h2><Chip s={researching ? "running" : "completed"} /></div>
          <div className="row wrap">
            <select className="input" style={{ maxWidth: 200 }} defaultValue="standard"><option value="quick">Quick (≈5 searches)</option><option value="standard">Standard (≈10)</option><option value="deep">Deep (≈18)</option></select>
            <input className="input" style={{ maxWidth: 200 }} defaultValue="Lagos, Nigeria" />
            <button className="btn btn-lime" disabled={researching} onClick={() => { setResearching(true); setTimeout(() => { setResearching(false); flash("Research complete: 11 searches, 6 sources."); }, 2200); }}>{researching ? "Researching…" : "Run research again"}</button>
          </div>
          {researching && <div className="progress"><span /></div>}
          <p className="muted">Completed today 09:20 · 11 searches · 6 sources · we never invent numbers, and can't see private analytics.</p>
          <h3>1. Market overview</h3><p>{demoReport.overview.text} <Src n={demoReport.overview.src} /> <Conf c={demoReport.overview.conf} /></p>
          <h3>2. Competitor comparison</h3>
          <div className="table-wrap"><table><thead><tr><th>Competitor</th><th>Positioning</th><th>Formats</th><th>Strengths</th><th>Weaknesses</th><th>Evidence</th></tr></thead><tbody>
            {demoReport.competitors.map((c) => <tr key={c.name}><td><b>{c.name}</b><br /><small>{c.handle} · {c.cadence}</small></td><td>{c.positioning}</td><td>{c.formats.join(", ")}</td><td>{c.strengths.join("; ")}</td><td>{c.weaknesses.join("; ")}</td><td><Src n={c.src} /><br /><Conf c={c.conf} /></td></tr>)}
          </tbody></table></div>
          {([["3. Content formats", demoReport.formats], ["4–5. Audience needs", demoReport.needs], ["7. Gaps competitors leave open", demoReport.gaps], ["Overused in this market", demoReport.overused]] as const).map(([h, l]) => (
            <div key={h}><h3>{h}</h3><ul>{l.map((c, i) => <li key={i}>{c.text} <Src n={c.src} /> <Conf c={c.conf} /></li>)}</ul></div>
          ))}
          <h3>6. Trends</h3><ul>{demoReport.trends.map((t, i) => <li key={i}><b>{t.date}:</b> {t.text} <Src n={t.src} /> <Conf c={t.conf} /></li>)}</ul>
          <h3>8. Recommended positioning</h3><p className="lead">{demoReport.positioning.text} <Src n={demoReport.positioning.src} /></p>
          <h3>9. Experiments</h3><ul>{demoReport.experiments.map((x) => <li key={x.idea}><b>{x.idea}</b>: {x.hypothesis} <small>Measure: {x.measure}</small></li>)}</ul>
          <h3>10. Sources and limits</h3>
          <ol className="srclist">{demoSources.map((s) => <li key={s.n} id={`src-${s.n}`}><a href="#" onClick={(e) => e.preventDefault()}>{s.title}</a> <small>{s.host} · {s.age} · retrieved today</small></li>)}</ol>
          <ul className="muted">{demoReport.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
          <button className="btn btn-ink" onClick={() => setTab("strategy")}>Build the strategy from this →</button>
        </section>
      )}

      {tab === "strategy" && (
        <section className="panel">
          <article className="cd-card strat">
            <div className="row between"><b>Version {demoStrategy.version}</b><Chip s={strategyStatus} /></div>
            <p className="lead">{demoStrategy.summary}</p>
            <div className="grid2">
              <div><h4>Positioning</h4><p>{demoStrategy.positioning}</p><h4>Creative direction</h4><p>{demoStrategy.direction}</p><h4>Visual language</h4><p>{demoStrategy.visual}</p><h4>Tone</h4><p>{demoStrategy.tone}</p></div>
              <div>
                <h4>Content pillars</h4>
                <div className="pillar-bar">{demoStrategy.pillars.map((p, i) => <span key={p.name} style={{ flex: p.share }} className={`pb${i}`} title={p.purpose}>{p.name} {p.share}%</span>)}</div>
                <ul>{demoStrategy.pillars.map((p) => <li key={p.name}><b>{p.name}</b>: {p.purpose}</li>)}</ul>
                <h4>Audience segments</h4><ul>{demoStrategy.segments.map((s) => <li key={s.name}><b>{s.name}</b>: {s.d}</li>)}</ul>
                <h4>Cadence</h4><p>{demoStrategy.cadence}</p>
              </div>
            </div>
            <h4>Why: research behind the decisions</h4><ul>{demoStrategy.research.map((r) => <li key={r.decision}><b>{r.decision}</b> because {r.because} <Src n={r.src} /></li>)}</ul>
            <h4>Ideas we rejected</h4><ul>{demoStrategy.rejected.map((r) => <li key={r.idea}><s>{r.idea}</s>: {r.why}</li>)}</ul>
            {strategyStatus === "awaiting_approval" ? (
              <div className="cd-form">
                <textarea rows={2} className="input" placeholder="Feedback for a revision (what to change; the rest stays)" />
                <div className="row"><button className="btn btn-lime" onClick={() => { setStrategyStatus("approved"); flash("Strategy approved. Plan the calendar next."); }}>Approve strategy</button><button className="btn btn-line" onClick={() => flash("Revision requested. Only the parts you flagged change.")}>Request revision</button><button className="btn btn-ghost" onClick={() => setStrategyStatus("rejected")}>Reject</button></div>
              </div>
            ) : <button className="btn btn-ink" onClick={() => setTab("calendar")}>Go to calendar →</button>}
          </article>
        </section>
      )}

      {tab === "calendar" && (
        <section className="panel">
          <div className="row between"><h2>December 2026</h2><div className="row"><Chip s="awaiting_approval" /><button className="btn btn-ink btn-sm" onClick={() => flash("Calendar plan approved. Items still need their own approval.")}>Approve calendar plan</button></div></div>
          <div className="inbox-filters">{(["month", "week", "list"] as const).map((v) => <button key={v} className={`pill ${view === v ? "on" : ""}`} onClick={() => setView(v)}>{v}</button>)}</div>
          {view !== "list" && (
            <div className={`cal-grid ${view}`}>
              {view === "month" && ["Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"].map((d) => <div key={d} className="cal-head">{d}</div>)}
              {days.map((d) => <div key={d} className="cal-day"><small>{Number(d.slice(8))}</small>{items.filter((x) => x.date === d).map((x) => <a key={x.id} href={`#item-${x.id}`} className={`cal-pill st-${x.status}`}>{x.platform} · {x.format.replace(/_/g, " ")}</a>)}</div>)}
            </div>
          )}
          <div className="items">
            {items.map((x) => {
              const locked = !["draft", "awaiting_approval", "rejected", "revision_requested"].includes(x.status);
              return (
                <article key={x.id} id={`item-${x.id}`} className="cd-card item">
                  <header className="row between"><span><b>{x.date}</b> · {x.platform} · {x.format.replace(/_/g, " ")} · {x.pillar}</span><Chip s={x.status} /></header>
                  <p className="hook">“{x.hook}”</p>
                  <dl className="idea">
                    <dt>Objective</dt><dd>{x.objective}</dd><dt>Insight</dt><dd>{x.insight}</dd><dt>Execution</dt><dd>{x.execution}</dd>
                    <dt>Viewer action</dt><dd>{x.action}</dd><dt>Evidence</dt><dd>{x.evidence} <Src n={x.src} /></dd><dt>Caption</dt><dd className="pre">{x.caption}</dd>
                    <dt>Production</dt><dd>{x.method.replace(/_/g, " ")}</dd>
                  </dl>
                  <div className="row wrap">
                    {!locked && <button className="btn btn-lime btn-sm" onClick={() => setStatus(x.id, "approved")}>Approve</button>}
                    {!locked && <button className="btn btn-ghost btn-sm" onClick={() => setStatus(x.id, "rejected")}>Reject</button>}
                    <button className="btn btn-line btn-sm" onClick={() => { setStatus(x.id, "awaiting_approval"); flash("Only this idea was regenerated. Everything else stayed the same."); }}>Revise with AI</button>
                    <button className="btn btn-ghost btn-sm" aria-label="Move up" onClick={() => move(x.id, -1)}>↑</button><button className="btn btn-ghost btn-sm" aria-label="Move down" onClick={() => move(x.id, 1)}>↓</button>
                    {locked && <small className="muted">🔒 Approved items are locked from AI rewrites.</small>}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {tab === "production" && (
        <section className="panel">
          <h2>Production</h2>
          <div className="table-wrap"><table><thead><tr><th>Item</th><th>Status</th><th>Spec</th><th className="num">Estimate</th></tr></thead><tbody>
            {items.filter((i) => ["approved", "generated", "revision_requested"].includes(i.status)).map((i) => <tr key={i.id}><td><b>{i.date}</b> {i.platform}<br /><small>“{i.hook}”</small></td><td><Chip s={i.status} /></td><td><small>{i.method === "ai_image" ? "Soul 2 · 4:5 · ×2" : i.method === "video_shoot" ? "Kling 3.0 · 9:16 · 5s" : "—"}</small></td><td className="num">{i.cost !== undefined ? `$${i.cost.toFixed(4)}` : "—"}</td></tr>)}
          </tbody></table></div>
          {ready.length > 0 && (
            <div className="cd-card confirm">
              <b>Generate {ready.length} approved item(s)</b>
              <p>Estimated cost: <b>${total.toFixed(4)}</b>. The server re-checks the price and every spending limit, and holds the budget before anything is sent. Failed or blocked generations aren&apos;t charged.</p>
              <label className="row"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I authorize up to ${total.toFixed(4)} of generation for these items</label>
              <button className="btn btn-lime" disabled={!confirmed} onClick={() => { ready.forEach((r) => setStatus(r.id, "generating")); setConfirmed(false); flash(`Generation authorized: $${total.toFixed(4)} held.`); }}>Generate</button>
            </div>
          )}
          <h3>Generation queue</h3>
          <div className="table-wrap"><table><thead><tr><th>When</th><th>Model</th><th>Status</th><th className="num">Est. cost</th><th>Note</th></tr></thead><tbody>
            {demoJobs.map((j, i) => <tr key={i}><td>{j.when}</td><td>{j.model}</td><td><Chip s={j.status} /></td><td className="num">${j.cost.toFixed(4)}</td><td><small>{j.note}</small></td></tr>)}
          </tbody></table></div>
          <h3>Gallery</h3>
          <div className="gallery">{items.filter((i) => i.image).map((i) => (
            <figure key={i.id}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={i.image} alt={i.hook} /><figcaption>{i.hook.slice(0, 40)}… · <a href={i.image} download>Download</a></figcaption></figure>
          ))}</div>
        </section>
      )}

      {tab === "usage" && (
        <section className="panel">
          <h2>Usage this month</h2>
          <p className="muted">Resets 1 Nov. AI tokens, searches and media are tracked separately. Media spend is priced at the admin-set rate (est.).</p>
          <div className="usage">
            {demoUsage.map((u) => { const pct = Math.min(100, ((u.used + u.held) / u.limit) * 100); const f = (v: number) => (u.money ? `$${v.toFixed(2)}` : String(v)); return (
              <div key={u.label} className={`usage-row ${pct >= 80 ? "warn" : ""}`}>
                <div className="row between"><b>{u.label}</b><span>{f(u.used)} used{u.held ? ` · ${f(u.held)} held` : ""} · {f(Math.max(0, u.limit - u.used - u.held))} left of {f(u.limit)}{pct >= 80 ? " ⚠️" : ""}</span></div>
                <div className="bar"><span style={{ width: `${(u.used / u.limit) * 100}%` }} /><span className="held" style={{ width: `${(u.held / u.limit) * 100}%` }} /></div>
              </div>); })}
          </div>
        </section>
      )}
    </>
  );
}

const MODEL_NAME: Record<string, string> = {
  "marketing-studio/image": "Marketing Studio Image", "openai/gpt-image-2": "GPT Image 2", "openai/gpt-image-2/edit": "GPT Image 2 Edit",
  "higgsfield-ai/soul/v2/standard": "Soul 2", "higgsfield-ai/cinema-studio/v2.5": "Cinema Studio 2.5", "higgsfield-ai/soul/cinematic": "Soul Cinema",
  "kling-video/v4.0/image-to-video": "Kling 4", "bytedance/seedance-2.0/image-to-video": "Seedance 2", "minimax/h3/image-to-video": "MiniMax H3",
  "bytedance/seedance-2.0/text-to-video": "Seedance 2", "kling-video/v4.0/text-to-video": "Kling 4", "alibaba/wan-3.0-prime/text-to-video": "Wan 3.0",
};

function QuickCreate({ onPlan, flash }: { onPlan: () => void; flash: (t: string) => void }) {
  const [task, setTask] = useState<Task>("product_photo");
  const [brief, setBrief] = useState("Party jollof tray, serves 40, December offer ₦76,500");
  const [photo, setPhoto] = useState(true);
  const [step, setStep] = useState<"form" | "director" | "done">("form");
  const t = TASKS[task];
  const pick = RECOMMENDED[task][0];
  return (
    <section className="cc-wrap">
      <div className="panel">
        <h2>What do you want to make?</h2>
        <div className="cc-tasks" role="radiogroup" aria-label="Type of content">
          {(Object.keys(TASKS) as Task[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={task === k} className={`cc-task${task === k ? " on" : ""}`} onClick={() => { setTask(k); setStep("form"); }}>
              <b>{TASKS[k].label}</b><small>{TASKS[k].kind === "video" ? "Video" : "Image"}</small>
            </button>
          ))}
        </div>
        <label className="field"><span>Describe it in a line</span><textarea rows={2} className="input" value={brief} onChange={(e) => setBrief(e.target.value)} /></label>
        <label className="row" style={{ fontSize: 14 }}><input type="checkbox" checked={photo} onChange={(e) => setPhoto(e.target.checked)} /> Use my product photo (jollof-trays.jpg){t.needsReference && !photo && <span className="hyp"> · this one works best with your photo</span>}</label>
        <div className="row wrap" style={{ marginTop: 10 }}>
          <button className="btn btn-ink" type="button" onClick={() => setStep("director")}>Ask the Creative Director</button>
          <button className="btn btn-line" type="button" onClick={onPlan}>Plan a full month instead →</button>
        </div>
      </div>
      {step !== "form" && (
        <div className="panel cc-director" aria-live="polite">
          <h2>Creative Director&apos;s plan</h2>
          <dl className="idea">
            <dt>Job</dt><dd>{t.label}: {t.why}</dd>
            <dt>Best model</dt><dd><b>{MODEL_NAME[pick] ?? pick}</b> <small className="muted">(picked automatically; backups: {RECOMMENDED[task].slice(1).map((p) => MODEL_NAME[p] ?? p).join(", ") || "none"})</small></dd>
            <dt>Prompt</dt><dd className="pre">{`${brief}. ${task === "poster" ? "Bold headline and price, clean layout, brand greens and ember orange." : "Warm firelight, real Lagos kitchen, handheld close-up, appetising steam."}${photo && t.needsReference ? " Keep the exact tray from the reference photo." : ""}`}</dd>
            <dt>Format</dt><dd>{t.kind === "video" ? "9:16 · 6 seconds · Reels, TikTok, Status" : task === "poster" ? "4:5 · Instagram feed" : "1:1 and 4:5"}</dd>
            <dt>Caption</dt><dd>Serves 40. Won&apos;t last 40 minutes. 🔥 Book 3 weeks ahead and save 10%. DM DECEMBER.</dd>
            <dt>Estimate</dt><dd>{t.kind === "video" ? "about $0.30" : "about $0.01"} · held from your budget, released if it fails</dd>
          </dl>
          {step === "director" ? (
            <div className="row wrap"><button className="btn btn-ink" type="button" onClick={() => { setStep("done"); flash("Preview only: in your live workspace this would generate now."); }}>Approve and generate</button><button className="btn btn-line" type="button" onClick={() => setStep("form")}>Change it</button></div>
          ) : <figure className="cc-result"><img src={`${"https://xmjgpprmddptoldhrswj.supabase.co/storage/v1/object/public/brand-assets/site/hero"}/jollof-trays.jpg`} alt="Sample result: party jollof tray" /><figcaption>Sample result (preview). Download, edit again, or add to your calendar.</figcaption></figure>}
        </div>
      )}
    </section>
  );
}
