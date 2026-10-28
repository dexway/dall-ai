import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { supabaseAdmin } from "@/lib/supabase/server";
import { BrandProfile, missingBrief, ResearchReport, Strategy, type Idea } from "@/lib/creative/schemas";
import { estimateCost, type ModelRow } from "@/lib/creative/rules";
import { generationConfigured } from "@/lib/creative/jobs";
import * as A from "./actions";
import StudioDemo from "./StudioDemo";
import "./studio.css";

export const metadata = { title: "Content Creator" };
export const maxDuration = 300;

const TABS = [["brief", "1 · Brief"], ["accounts", "2 · Accounts"], ["research", "3 · Research"], ["strategy", "4 · Strategy"], ["calendar", "5 · Calendar"], ["production", "6 · Production"], ["autopilot", "Autopilot"], ["usage", "Usage"]] as const;
const OBJECTIVES = ["awareness", "engagement", "leads", "bookings", "sales", "retention", "other"];
const PLATFORMS = ["instagram", "tiktok", "facebook", "x", "linkedin", "youtube", "whatsapp"];
const STATUS_LABEL: Record<string, string> = { draft: "Draft", awaiting_approval: "Awaiting approval", approved: "Approved", rejected: "Rejected", revision_requested: "Revision requested", generation_queued: "Generation queued", generating: "Generating", generated: "Ready for review", completed: "Completed", failed: "Failed", cancelled: "Cancelled" };
const ERR: Record<string, string> = { role: "Only owners and admins can change the Creative Director.", brand: "Pick or create a brand first.", brief: "Check the brief", asset: "Brand files must be PNG, JPG, WEBP or PDF under 4 MB.", account: "Add at least one account.", running: "Research is already running for this brand.", ai: "The Creative Director couldn't finish that", state: "That step isn't available right now", locked: "Approved items are locked. Request a revision to change them.", model: "Pick a model an admin has enabled.", confirm: "Tick the box to confirm the spend.", quota: "Generation blocked" };
const OK: Record<string, string> = { brief: "Brief saved. Now add the accounts to research.", suggested: "Suggestions added below. Keep the ones you want; nothing is researched until you accept it.", research: "Research is running. It usually takes 1–3 minutes; refresh to see progress.", autopilot: "Autopilot saved. It runs every 5 minutes.", generating: "Generation authorized. Jobs are queued and the budget is held; results appear here as they finish." };

function Chip({ s }: { s: string }) { return <span className={`chip st-${s}`}>{STATUS_LABEL[s] ?? s.replace(/_/g, " ")}</span>; }
function Sources({ urls, map }: { urls: string[]; map: Map<string, string> }) {
  if (!urls.length) return <span className="hyp">Hypothesis (no source)</span>;
  return <span className="srcs">{urls.map((u, i) => <a key={u} href={u} target="_blank" rel="noreferrer" title={map.get(u) ?? u}>[{i + 1}]</a>)}</span>;
}
function Conf({ c }: { c: string }) { return <span className={`conf conf-${c}`}>{c} confidence</span>; }

export default async function Studio({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireWorkspace();
  const sp = await searchParams;
  const db = supabaseAdmin();
  const ws = ctx.workspace.id;
  const tab = (TABS.find(([k]) => k === sp.tab)?.[0]) ?? "brief";
  const { data: brands, error: setupErr } = await db.from("creative_brands").select("id,name,onboarding_step").eq("workspace_id", ws).order("created_at");
  // Until the Creative Director tables exist (migrations awaiting approval), or when ?demo=1, show the preview.
  if (setupErr || sp.demo === "1") return <StudioDemo />;
  const brand = (brands ?? []).find((b) => b.id === sp.b) ?? (brands ?? [])[0];

  if (!brand) {
    return (
      <>
        <div className="page-head"><div><h1>Creative Director</h1><p>Your AI creative agency: it researches your market, builds a strategy, plans a month of content, and produces approved visuals, never spending without your yes.</p></div></div>
        <section className="panel cd-hero">
          <ol className="cd-flow">{["Brief", "Competitors & inspiration", "Real research with sources", "Strategy you approve", "Calendar you approve", "Approved items generated within your budget"].map((s, i) => <li key={s}><b>{i + 1}</b>{s}</li>)}</ol>
          <form action={A.createBrand} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input name="name" className="input" placeholder="Brand name" defaultValue={ctx.workspace.name} style={{ maxWidth: 320 }} />
            <button className="btn btn-lime">Start with this brand</button>
          </form>
        </section>
      </>
    );
  }

  const B = brand.id;
  const [{ data: full }, { data: accounts }, { data: runs }, { data: strategies }, { data: calendars }, { data: models }] = await Promise.all([
    db.from("creative_brands").select("*").eq("id", B).single(),
    db.from("creative_accounts").select("*").eq("brand_id", B).order("created_at"),
    db.from("research_runs").select("id,status,prefs,report,searches_used,error,created_at,finished_at").eq("brand_id", B).order("created_at", { ascending: false }).limit(5),
    db.from("creative_strategies").select("*").eq("brand_id", B).order("version", { ascending: false }).limit(6),
    db.from("content_calendars").select("*").eq("brand_id", B).order("created_at", { ascending: false }).limit(6),
    db.from("provider_models").select("*").eq("enabled", true).order("kind"),
  ]);
  const profile = BrandProfile.parse(full?.profile ?? {});
  const missing = missingBrief(profile, accounts ?? []);
  const lastRun = (runs ?? [])[0];
  const doneRun = (runs ?? []).find((r) => r.status === "completed");
  const { data: sources } = doneRun ? await db.from("research_sources").select("url,title,source_name,page_age,retrieved_at").eq("run_id", doneRun.id).order("source_name") : { data: [] };
  const srcMap = new Map((sources ?? []).map((s) => [s.url, `${s.title ?? s.url} · ${s.source_name ?? ""}`]));
  const approved = (strategies ?? []).find((s) => s.status === "approved");
  const pending = (strategies ?? []).find((s) => ["awaiting_approval", "generating"].includes(s.status));
  const cal = (calendars ?? []).find((c) => c.id === sp.cal) ?? (calendars ?? [])[0];
  const { data: items } = cal ? await db.from("content_items").select("*").eq("calendar_id", cal.id).order("position") : { data: [] };
  const savedStep = Number(full?.onboarding_step ?? 1);
  const step = sp.step ? Math.min(2, Math.max(1, Number(sp.step) || 1)) : savedStep === 2 ? 2 : 1;
  const href = (t: string, q = "") => `/dashboard/studio?b=${B}&tab=${t}${q}`;

  return (
    <>
      <div className="page-head">
        <div><h1>Content Creator</h1><p>Your Creative Director agent researches, plans your content and picks the best AI model for every photo and video. Nothing is spent without your yes.</p></div>
        <form className="cd-brand" method="get">
          <input type="hidden" name="tab" value={tab} />
          <select name="b" defaultValue={B} className="input">{(brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <button className="btn btn-line btn-sm">Switch</button>
        </form>
      </div>
      {sp.error && <div className="notice notice-bad" role="alert">{ERR[sp.error] ?? "Something went wrong."}{sp.why ? `: ${decodeURIComponent(sp.why)}` : "."}</div>}
      {sp.saved && OK[sp.saved] && <div className="notice notice-ok" role="status">{OK[sp.saved]}</div>}

      <nav className="cd-tabs" aria-label="Creative Director steps">
        {TABS.map(([k, l]) => <Link key={k} href={href(k)} aria-current={tab === k ? "page" : undefined}>{l}</Link>)}
        <form action={A.createBrand} className="cd-newbrand"><input name="name" placeholder="New brand" className="input" /><button className="btn btn-ghost btn-sm">+ Brand</button></form>
      </nav>

      {tab === "brief" && (
        <section className="panel">
          <div className="cd-steps"><span className={step === 1 ? "on" : ""}>A · Brand profile</span><span className={step === 2 ? "on" : ""}>B · Offers, voice & limits</span></div>
          <form action={A.saveBrief} className="cd-form">
            <input type="hidden" name="b" value={B} /><input type="hidden" name="step" value={step} />
            {step === 1 ? <>
              <label className="field"><span>Brand name</span><input name="name" className="input" defaultValue={full?.name} /></label>
              <div className="grid3">
                <label className="field"><span>Website</span><input name="website" className="input" defaultValue={profile.website} placeholder="https://" /></label>
                <label className="field"><span>Industry</span><input name="industry" className="input" defaultValue={profile.industry} placeholder="e.g. boutique hotel, small chops caterer" /></label>
                <label className="field"><span>Location</span><input name="location" className="input" defaultValue={profile.location} placeholder="Lekki, Lagos" /></label>
              </div>
              <label className="field"><span>Products and services</span><textarea name="products" rows={3} className="input" defaultValue={profile.products} /></label>
              <label className="field"><span>Target audience</span><textarea name="audience" rows={2} className="input" defaultValue={profile.audience} placeholder="Who buys, age range, where they live, what they care about" /></label>
              <label className="field"><span>Customer problems you solve</span><textarea name="problems" rows={2} className="input" defaultValue={profile.problems} /></label>
              <fieldset className="checks"><legend>Business goals</legend>{OBJECTIVES.map((o) => <label key={o}><input type="checkbox" name="objectives" value={o} defaultChecked={profile.objectives.includes(o as never)} /> {o}</label>)}</fieldset>
            </> : <>
              <label className="field"><span>Main offers</span><textarea name="offers" rows={2} className="input" defaultValue={profile.offers} /></label>
              <label className="field"><span>What makes you different</span><textarea name="differentiators" rows={2} className="input" defaultValue={profile.differentiators} /></label>
              <label className="field"><span>Current promotions</span><input name="promotions" className="input" defaultValue={profile.promotions} /></label>
              <div className="grid3">
                <label className="field"><span>Brand voice & personality</span><input name="voice" className="input" defaultValue={profile.voice} placeholder="warm, witty, premium…" /></label>
                <label className="field"><span>Language</span><input name="language" className="input" defaultValue={profile.language} placeholder="English, Pidgin" /></label>
                <label className="field"><span>Tone</span><input name="tone" className="input" defaultValue={profile.tone} /></label>
              </div>
              <fieldset className="checks"><legend>Platforms you use</legend>{PLATFORMS.map((p) => <label key={p}><input type="checkbox" name="platforms" value={p} defaultChecked={profile.platforms.includes(p as never)} /> {p}</label>)}</fieldset>
              <div className="grid3">
                <label className="field"><span>Posting frequency</span><input name="frequency" className="input" defaultValue={profile.frequency} placeholder="4 posts + 3 reels a week" /></label>
                <label className="field"><span>Campaign start</span><input name="campaign_start" type="date" className="input" defaultValue={profile.campaign_start} /></label>
                <label className="field"><span>Campaign end</span><input name="campaign_end" type="date" className="input" defaultValue={profile.campaign_end} /></label>
              </div>
              <label className="field"><span>Production limits and content restrictions</span><textarea name="restrictions" rows={2} className="input" defaultValue={profile.restrictions} placeholder="No faces of staff, only our real dishes, budget for 1 shoot a month…" /></label>
              <label className="field"><span>Claims you must never make</span><textarea name="prohibited_claims" rows={2} className="input" defaultValue={profile.prohibited_claims} /></label>
              <label className="field"><span>Brand files (logo, product photos, guidelines — PNG, JPG, WEBP, PDF, max 6)</span><input name="assets" type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" /></label>
              {(full?.asset_paths ?? []).length > 0 && <p className="muted">{(full!.asset_paths as string[]).length} file(s) on record.</p>}
            </>}
            <div className="row"><button className="btn btn-ink">{step === 1 ? "Save and continue" : "Save brief"}</button>{step === 2 && <Link href={href("brief", "&step=1")}>← Back</Link>}</div>
          </form>
        </section>
      )}

      {tab === "accounts" && (
        <section className="panel">
          <h2>Who should we study?</h2>
          <p className="muted"><b>Direct competitors</b> sell to the same customers as you; we study them to find gaps and avoid sounding like them. <b>Inspiration accounts</b> can be in any industry; we study them for craft: hooks, formats, visual style. Public pages only: private analytics are never available.</p>
          {missing.length > 0 && <div className="notice" style={{ background: "#FBF0DC", color: "#8A5A0B" }}>Research will be weaker without: {missing.join(" · ")}.</div>}
          <div className="grid2">
            {(["competitor", "inspiration", "leader", "campaign"] as const).map((k) => {
              const rows = (accounts ?? []).filter((a) => a.kind === k);
              return (
                <div key={k} className="cd-card">
                  <h3>{{ competitor: "Direct competitors (3–10)", inspiration: "Inspiration accounts (3–10)", leader: "Industry leaders (optional)", campaign: "Specific posts or campaigns (optional)" }[k]}</h3>
                  <ul className="acc">{rows.map((a) => (
                    <li key={a.id} className={a.accepted ? "" : "sugg"}>
                      <span><b>{a.handle_or_url}</b>{a.platform ? ` · ${a.platform}` : ""}{a.source === "suggested" && <em> suggested</em>}{a.notes ? <small>{a.notes}</small> : null}</span>
                      <form action={A.setAccount}><input type="hidden" name="b" value={B} /><input type="hidden" name="id" value={a.id} />
                        {!a.accepted && <button name="op" value="accept" className="btn btn-lime btn-sm">Keep</button>}
                        <button name="op" value="remove" className="btn btn-ghost btn-sm">Remove</button></form>
                    </li>))}
                  </ul>
                  <form action={A.addAccount} className="row">
                    <input type="hidden" name="b" value={B} /><input type="hidden" name="kind" value={k} />
                    <textarea name="handles" rows={2} className="input" placeholder="@handle or profile/post link — one per line" />
                    <select name="platform" className="input" style={{ maxWidth: 130 }}><option value="">Platform</option>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select>
                    <button className="btn btn-line btn-sm">Add</button>
                  </form>
                </div>
              );
            })}
          </div>
          <form action={A.discoverAccounts} className="row" style={{ marginTop: 12 }}>
            <input type="hidden" name="b" value={B} />
            <button className="btn btn-ink">🔎 Suggest more accounts</button>
            <small className="muted">Uses a few web searches from your research allowance. Suggestions are added unaccepted.</small>
          </form>
        </section>
      )}

      {tab === "research" && (
        <section className="panel">
          <div className="row between"><h2>Research</h2>{lastRun && <Chip s={lastRun.status} />}</div>
          <form action={A.startResearch} className="cd-form">
            <input type="hidden" name="b" value={B} />
            <div className="grid3">
              <label className="field"><span>Depth</span><select name="depth" className="input" defaultValue={(full?.research_prefs as { depth?: string })?.depth ?? "standard"}><option value="quick">Quick (≈5 searches)</option><option value="standard">Standard (≈10)</option><option value="deep">Deep (≈18)</option></select></label>
              <label className="field"><span>Geographic focus</span><input name="geo" className="input" defaultValue={(full?.research_prefs as { geo?: string })?.geo ?? "Nigeria"} /></label>
              <label className="field"><span>Campaign period</span><input name="period" className="input" placeholder="December festive season" /></label>
            </div>
            <fieldset className="checks"><legend>Platforms to focus on</legend>{PLATFORMS.map((p) => <label key={p}><input type="checkbox" name="platforms" value={p} defaultChecked={profile.platforms.includes(p as never)} /> {p}</label>)}</fieldset>
            <p className="muted">We'll search the public web (news, websites, public profile pages and posts that search engines index) for the {(accounts ?? []).filter((a) => a.accepted).length} accounts you kept, your industry and your audience. We can't see private analytics, stories, or anything behind a login, and we never invent numbers.</p>
            <button className="btn btn-lime" disabled={lastRun?.status === "running" || lastRun?.status === "queued"}>{lastRun?.status === "running" ? "Researching…" : "Run research"}</button>
          </form>
          {lastRun?.status === "failed" && <div className="notice notice-bad">{lastRun.error} <form action={A.retryResearch} style={{ display: "inline" }}><input type="hidden" name="b" value={B} /><input type="hidden" name="run" value={lastRun.id} /><button className="btn btn-line btn-sm">Retry</button></form></div>}
          {doneRun && (() => {
            const r = ResearchReport.safeParse(doneRun.report);
            if (!r.success) return <p>Report unreadable.</p>;
            const rep = r.data;
            return (
              <div className="report">
                <p className="muted">Completed {new Date(doneRun.finished_at!).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })} · {doneRun.searches_used} searches · {(sources ?? []).length} sources</p>
                <h3>1. Market overview</h3><p>{rep.overview.text} <Sources urls={rep.overview.sources} map={srcMap} /> <Conf c={rep.overview.confidence} /></p>
                <h3>2. Competitor comparison</h3>
                <div className="table-wrap"><table><thead><tr><th>Competitor</th><th>Positioning</th><th>Formats</th><th>Strengths</th><th>Weaknesses</th><th>Evidence</th></tr></thead><tbody>
                  {rep.competitors.map((c) => <tr key={c.name}><td><b>{c.name}</b><br /><small>{c.handle_or_url}</small><br /><small>{c.observed_cadence}</small></td><td>{c.positioning}</td><td>{c.formats.join(", ")}</td><td>{c.strengths.join("; ")}</td><td>{c.weaknesses.join("; ")}</td><td><Sources urls={c.sources} map={srcMap} /><br /><Conf c={c.confidence} /></td></tr>)}
                </tbody></table></div>
                {([["3. Content formats", rep.format_analysis], ["4–5. Audience needs & opportunities", rep.audience_needs], ["6. Trends", rep.trends], ["7. Gaps competitors leave open", rep.content_gaps], ["Overused in this market", rep.overused]] as const).map(([h, list]) => (
                  <div key={h}><h3>{h}</h3><ul>{list.map((c, i) => <li key={i}>{"date" in c && c.date ? <b>{c.date}: </b> : null}{c.text} <Sources urls={c.sources} map={srcMap} /> <Conf c={c.confidence} /></li>)}</ul></div>
                ))}
                <h3>8. Recommended positioning</h3><p>{rep.positioning.text} <Sources urls={rep.positioning.sources} map={srcMap} /></p>
                <h3>9. Experiments to run</h3><ul>{rep.experiments.map((x, i) => <li key={i}><b>{x.idea}</b> — {x.hypothesis} <small>Measure: {x.measure}</small></li>)}</ul>
                <h3>10. Sources and limits</h3>
                <ol className="srclist">{(sources ?? []).map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title ?? s.url}</a> <small>{s.source_name}{s.page_age ? ` · ${s.page_age}` : ""} · retrieved {new Date(s.retrieved_at).toLocaleDateString("en-NG")}</small></li>)}</ol>
                {rep.limitations.length > 0 && <ul className="muted">{rep.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>}
                <Link className="btn btn-ink" href={href("strategy")}>Build the strategy from this →</Link>
              </div>
            );
          })()}
        </section>
      )}

      {tab === "strategy" && (
        <section className="panel">
          <div className="row between"><h2>Creative strategy</h2>{approved && <span className="chip st-approved">v{approved.version} approved</span>}</div>
          {!doneRun ? <p>Run research first. The strategy is built on it. <Link href={href("research")}>Go to research →</Link></p> : !pending && (
            <form action={A.makeStrategy} className="row"><input type="hidden" name="b" value={B} /><button className="btn btn-lime">{approved ? "Draft a new strategy" : "Draft the strategy"}</button><small className="muted">Uses your AI strategy allowance.</small></form>
          )}
          {[pending, approved].filter(Boolean).map((s) => {
            if (s!.status === "generating") return <p key={s!.id} className="muted">Drafting… refresh in a minute.</p>;
            const st = Strategy.safeParse(s!.content);
            if (!st.success) return null;
            const v = st.data;
            return (
              <article key={s!.id} className="cd-card strat">
                <div className="row between"><b>Version {s!.version}</b><Chip s={s!.status} /></div>
                <p className="lead">{v.summary}</p>
                <div className="grid2">
                  <div><h4>Positioning</h4><p>{v.positioning}</p><h4>Creative direction</h4><p>{v.creative_direction}</p><h4>Visual language</h4><p>{v.visual_language}</p><h4>Tone</h4><p>{v.tone}</p></div>
                  <div>
                    <h4>Content pillars</h4>
                    <div className="pillars">{v.pillars.map((p) => <div key={p.name} style={{ flexBasis: `${Math.max(18, p.share_pct)}%` }}><b>{p.name}</b> {p.share_pct}%<small>{p.purpose}</small></div>)}</div>
                    <h4>Audience segments</h4><ul>{v.segments.map((g) => <li key={g.name}><b>{g.name}</b>: {g.description}</li>)}</ul>
                    <h4>Channels</h4><ul>{v.formats.map((f) => <li key={f.platform}><b>{f.platform}</b> — {f.role} ({f.formats.join(", ")})</li>)}</ul>
                    <h4>Cadence</h4><p>{v.cadence}</p>
                  </div>
                </div>
                <h4>Why: research behind the decisions</h4><ul>{v.research_links.map((l, i) => <li key={i}><b>{l.decision}</b> because {l.because} <Sources urls={l.sources} map={srcMap} /></li>)}</ul>
                <div className="grid2"><div><h4>Goals & measurement</h4><ul>{v.conversion_goals.map((g) => <li key={g}>{g}</li>)}{v.measurement.map((m) => <li key={m.metric}><b>{m.metric}</b>: {m.why}</li>)}</ul></div>
                  <div><h4>Ideas we rejected</h4><ul>{v.rejected_ideas.map((r) => <li key={r.idea}><s>{r.idea}</s> — {r.why_rejected}</li>)}</ul></div></div>
                {s!.status === "awaiting_approval" && (
                  <form action={A.decideStrategy} className="cd-form">
                    <input type="hidden" name="b" value={B} /><input type="hidden" name="id" value={s!.id} />
                    <textarea name="feedback" rows={2} className="input" placeholder="Feedback for a revision (what to change; the rest stays)" />
                    <div className="row"><button name="decision" value="approve" className="btn btn-lime">Approve strategy</button><button name="decision" value="revise" className="btn btn-line">Request revision</button><button name="decision" value="reject" className="btn btn-ghost">Reject</button></div>
                  </form>
                )}
              </article>
            );
          })}
        </section>
      )}

      {tab === "calendar" && (
        <section className="panel">
          <div className="row between"><h2>Content calendar</h2>{cal && <Chip s={cal.status} />}</div>
          {!approved ? <p>Approve a strategy first. <Link href={href("strategy")}>Go to strategy →</Link></p> : (
            <form action={A.makeCalendar} className="row"><input type="hidden" name="b" value={B} /><input type="hidden" name="strategy" value={approved.id} />
              <input type="month" name="month" className="input" style={{ maxWidth: 180 }} defaultValue={new Date(Date.now() + 15 * 86400_000).toISOString().slice(0, 7)} />
              <button className="btn btn-lime">Plan this month</button></form>
          )}
          {(calendars ?? []).length > 1 && <div className="inbox-filters">{(calendars ?? []).map((c) => <Link key={c.id} href={href("calendar", `&cal=${c.id}`)} className={`pill ${c.id === cal?.id ? "on" : ""}`}>{c.month.slice(0, 7)}</Link>)}</div>}
          {cal?.status === "generating" && <p className="muted">Planning… refresh in a minute.</p>}
          {cal && (items ?? []).length > 0 && <>
            <div className="row between">
              <div className="inbox-filters">{["month", "week", "list"].map((v) => <Link key={v} href={href("calendar", `&cal=${cal.id}&view=${v}`)} className={`pill ${(sp.view ?? "month") === v ? "on" : ""}`}>{v}</Link>)}</div>
              {cal.status !== "approved" && <form action={A.approveCalendar}><input type="hidden" name="b" value={B} /><input type="hidden" name="cal" value={cal.id} /><button className="btn btn-ink btn-sm">Approve calendar plan</button></form>}
            </div>
            <p className="muted" style={{ fontSize: 13 }}>Approving the calendar approves the plan. Each item still needs its own approval, and generation needs a separate confirmation with the price.</p>
            {(sp.view ?? "month") !== "list" && (
              <div className={`cal-grid ${sp.view === "week" ? "week" : ""}`}>
                {(() => {
                  const first = new Date(`${cal.month}T00:00:00Z`); const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
                  const shown = sp.view === "week" ? Math.min(7, days) : days; const offset = sp.view === "week" ? Math.max(0, Number(sp.wk ?? 0)) * 7 : 0;
                  return Array.from({ length: shown }, (_, i) => {
                    const d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), i + 1 + offset)).toISOString().slice(0, 10);
                    const dayItems = (items ?? []).filter((x) => x.planned_date === d);
                    return <div key={d} className="cal-day"><small>{Number(d.slice(8))}</small>{dayItems.map((x) => <a key={x.id} href={`#item-${x.id}`} className={`cal-pill st-${x.status}`}>{x.platform} · {x.format.replace(/_/g, " ")}</a>)}</div>;
                  });
                })()}
              </div>
            )}
            {sp.view === "week" && <div className="row">{[0, 1, 2, 3, 4].map((w) => <Link key={w} href={href("calendar", `&cal=${cal.id}&view=week&wk=${w}`)} className={`pill ${Number(sp.wk ?? 0) === w ? "on" : ""}`}>Week {w + 1}</Link>)}</div>}
            <div className="items">
              {(items ?? []).map((x) => {
                const idea = x.idea as Idea;
                const locked = !["draft", "awaiting_approval", "rejected", "revision_requested"].includes(x.status);
                return (
                  <article key={x.id} id={`item-${x.id}`} className="cd-card item">
                    <header className="row between"><span><b>{x.planned_date}</b> · {x.platform} · {x.format.replace(/_/g, " ")} · {x.pillar}{x.campaign ? ` · ${x.campaign}` : ""}</span><Chip s={x.status} /></header>
                    <p className="hook">“{idea.hook}”</p>
                    <dl className="idea">
                      <dt>Objective</dt><dd>{idea.objective}</dd><dt>Audience</dt><dd>{idea.audience}</dd><dt>Insight</dt><dd>{idea.insight}</dd>
                      <dt>Execution</dt><dd>{idea.execution}</dd><dt>Why now</dt><dd>{idea.why_now}</dd><dt>Different because</dt><dd>{idea.differentiation}</dd>
                      <dt>Viewer action</dt><dd>{idea.action}</dd><dt>Production</dt><dd>{idea.production} <small>({idea.production_method.replace(/_/g, " ")})</small></dd>
                      <dt>Evidence</dt><dd>{idea.evidence.kind === "research" ? "Research: " : "Hypothesis: "}{idea.evidence.note} <Sources urls={idea.evidence.sources} map={srcMap} /></dd>
                      <dt>Measure</dt><dd>{idea.measure}</dd>
                      {idea.visual_direction && <><dt>Visual</dt><dd>{idea.visual_direction}</dd></>}
                      {idea.shots.length > 0 && <><dt>Shots</dt><dd><ol>{idea.shots.map((s, i) => <li key={i}>{s.seconds != null ? `${s.seconds}s · ` : ""}{s.description}</li>)}</ol></dd></>}
                      {idea.caption && <><dt>Caption</dt><dd className="pre">{idea.caption}</dd></>}
                      {idea.cta && <><dt>CTA</dt><dd>{idea.cta}</dd></>}
                    </dl>
                    <div className="row wrap">
                      <form action={A.itemAction} className="row wrap"><input type="hidden" name="b" value={B} /><input type="hidden" name="cal" value={cal.id} /><input type="hidden" name="id" value={x.id} />
                        {!locked && <button name="op" value="approve" className="btn btn-lime btn-sm">Approve</button>}
                        {!locked && <button name="op" value="reject" className="btn btn-ghost btn-sm">Reject</button>}
                        <button name="op" value="up" className="btn btn-ghost btn-sm" aria-label="Move up">↑</button><button name="op" value="down" className="btn btn-ghost btn-sm" aria-label="Move down">↓</button>
                        {!locked && <button name="op" value="remove" className="btn btn-ghost btn-sm">Remove</button>}
                      </form>
                      <details><summary className="btn btn-line btn-sm">Revise with AI</summary>
                        <form action={A.itemAction} className="cd-form"><input type="hidden" name="b" value={B} /><input type="hidden" name="cal" value={cal.id} /><input type="hidden" name="id" value={x.id} /><input type="hidden" name="op" value="revise" />
                          <textarea name="feedback" rows={2} className="input" placeholder="What to change (only this item changes)" /><button className="btn btn-ink btn-sm">Regenerate this idea</button></form></details>
                      {!locked && <details><summary className="btn btn-line btn-sm">Edit</summary>
                        <form action={A.itemAction} className="cd-form"><input type="hidden" name="b" value={B} /><input type="hidden" name="cal" value={cal.id} /><input type="hidden" name="id" value={x.id} /><input type="hidden" name="op" value="edit" />
                          <label className="field"><span>Date</span><input name="planned_date" type="date" defaultValue={x.planned_date ?? ""} className="input" /></label>
                          <label className="field"><span>Hook</span><input name="hook" defaultValue={idea.hook} className="input" /></label>
                          <label className="field"><span>Caption / script</span><textarea name="caption" rows={4} defaultValue={idea.caption} className="input" /></label>
                          <label className="field"><span>CTA</span><input name="cta" defaultValue={idea.cta} className="input" /></label>
                          <label className="field"><span>Visual direction</span><textarea name="visual_direction" rows={2} defaultValue={idea.visual_direction} className="input" /></label>
                          <button className="btn btn-ink btn-sm">Save edits</button></form></details>}
                    </div>
                  </article>
                );
              })}
            </div>
          </>}
        </section>
      )}

      {tab === "production" && <Production B={B} ws={ws} models={(models ?? []) as ModelRow[]} sp={sp} />}
      {tab === "usage" && <Usage ws={ws} B={B} userId={ctx.user.id} />}
      {tab === "autopilot" && <Autopilot B={B} ws={ws} />}
    </>
  );
}

async function Production({ B, ws, models, sp }: { B: string; ws: string; models: ModelRow[]; sp: Record<string, string | undefined> }) {
  const db = supabaseAdmin();
  const [{ data: items }, { data: jobs }, { data: assets }] = await Promise.all([
    db.from("content_items").select("id,planned_date,platform,format,idea,status,spec,spec_model_id,version").eq("brand_id", B).in("status", ["approved", "generation_queued", "generating", "generated", "failed", "completed"]).order("planned_date"),
    db.from("generation_jobs").select("id,item_id,status,est_cost_usd,error,created_at,finished_at,provider_models(name)").eq("brand_id", B).order("created_at", { ascending: false }).limit(30),
    db.from("creative_assets").select("id,item_id,path,kind,content_type,created_at").eq("brand_id", B).order("created_at", { ascending: false }).limit(40),
  ]);
  const signed = assets?.length ? (await db.storage.from("creative-assets").createSignedUrls(assets.map((a) => a.path), 3600)).data ?? [] : [];
  const urlOf = new Map(signed.map((s) => [s.path, s.signedUrl]));
  const byModel = new Map(models.map((m) => [m.id, { ...m, usd_per_unit: Number(m.usd_per_unit) }]));
  const ready = (items ?? []).filter((i) => i.spec && i.spec_model_id && byModel.has(i.spec_model_id) && ["approved", "failed", "generated"].includes(i.status));
  const total = ready.reduce((s, i) => s + estimateCost(byModel.get(i.spec_model_id!)!, i.spec as { duration_seconds?: number; variations?: number }), 0);
  const configured = generationConfigured();
  return (
    <section className="panel">
      <h2>Production</h2>
      {!configured && <div className="notice" style={{ background: "#FBF0DC", color: "#8A5A0B" }}>Generation is not connected yet. A Dall AI admin must add the Higgsfield API key, enable models with their prices, and set a media spending cap. Until then nothing can be generated or charged.</div>}
      {!models.length && <p className="muted">No generation models are enabled yet (admin → Creative models).</p>}
      <h3>Approved items</h3>
      {!(items ?? []).length ? <p className="muted">Approve calendar items first. Only approved items can be prepared and generated.</p> : (
        <div className="table-wrap"><table><thead><tr><th>Item</th><th>Status</th><th>Production spec</th><th className="num">Estimate</th></tr></thead><tbody>
          {(items ?? []).map((i) => {
            const m = i.spec_model_id ? byModel.get(i.spec_model_id) : undefined;
            const spec = i.spec as { prompt?: string; aspect_ratio?: string; duration_seconds?: number; variations?: number } | null;
            return <tr key={i.id}><td><b>{i.planned_date}</b> {i.platform} · {i.format.replace(/_/g, " ")}<br /><small>“{(i.idea as Idea).hook}”</small></td><td><Chip s={i.status} /></td>
              <td>{spec ? <><small>{m?.name} · {spec.aspect_ratio}{spec.duration_seconds ? ` · ${spec.duration_seconds}s` : ""} · ×{spec.variations ?? 1}</small><details><summary><small>Prompt</small></summary><small className="pre">{spec.prompt}</small></details></> : <small className="muted">Not prepared</small>}
                {models.length > 0 && ["approved", "failed", "generated"].includes(i.status) && <form action={A.prepareSpec} className="row"><input type="hidden" name="b" value={B} /><input type="hidden" name="id" value={i.id} />
                  <select name="model" className="input" defaultValue={i.spec_model_id ?? "auto"}><option value="auto">Auto: best model for this post</option>{models.map((mm) => <option key={mm.id} value={mm.id}>{mm.name} ({mm.kind}, ${Number(mm.usd_per_unit)}/{mm.unit})</option>)}</select><button className="btn btn-line btn-sm">{spec ? "Re-prepare" : "Prepare"}</button></form>}</td>
              <td className="num">{m && spec ? `$${estimateCost(m, spec).toFixed(4)}` : "—"}</td></tr>;
          })}
        </tbody></table></div>
      )}
      {ready.length > 0 && (
        <form action={A.generateBatch} className="cd-card confirm">
          <input type="hidden" name="b" value={B} /><input type="hidden" name="confirmed_total" value={total.toFixed(6)} />
          {ready.map((i) => <input key={i.id} type="hidden" name="items" value={i.id} />)}
          <b>Generate {ready.length} approved item(s)</b>
          <p>Estimated cost: <b>${total.toFixed(4)}</b> at the admin-set model prices. The server re-checks the price and every spending limit, and holds the budget before anything is sent. Failed or blocked generations aren&apos;t charged.</p>
          <label className="row"><input type="checkbox" name="confirm" value="yes" required /> I authorize up to ${total.toFixed(4)} of generation for these items</label>
          <button className="btn btn-lime" disabled={!configured}>Generate</button>
        </form>
      )}
      <h3>Generation queue</h3>
      {!(jobs ?? []).length ? <p className="muted">No jobs yet.</p> : <div className="table-wrap"><table><thead><tr><th>When</th><th>Model</th><th>Status</th><th className="num">Est. cost</th><th>Note</th></tr></thead><tbody>
        {(jobs ?? []).map((j) => <tr key={j.id}><td>{new Date(j.created_at).toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" })}</td><td>{(j.provider_models as unknown as { name: string } | null)?.name}</td><td><Chip s={j.status === "stored" ? "generated" : j.status} /></td><td className="num">${Number(j.est_cost_usd).toFixed(4)}</td><td><small>{j.error}</small></td></tr>)}
      </tbody></table></div>}
      <h3>Gallery</h3>
      {!(assets ?? []).length ? <p className="muted">Generated images and videos appear here, stored in your workspace.</p> : (
        <div className="gallery">{(assets ?? []).map((a) => { const u = urlOf.get(a.path) ?? undefined; return (
          <figure key={a.id}>{a.kind === "video" ? <video src={u} controls preload="metadata" /> : /* eslint-disable-next-line @next/next/no-img-element */ <img src={u} alt="Generated asset" loading="lazy" />}
            <figcaption><a href={u} download>Download</a></figcaption></figure>); })}</div>
      )}
      {sp.n && <p className="muted">{sp.n} job(s) authorized.</p>}
    </section>
  );
}

async function Usage({ ws, B, userId }: { ws: string; B: string; userId: string }) {
  const db = supabaseAdmin();
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const reset = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1));
  const [{ data: ledger }, { data: holds }, { data: pols }, { data: sub }] = await Promise.all([
    db.from("usage_ledger").select("resource,amount,kind,basis,brand_id,user_id,model,created_at").eq("workspace_id", ws).gte("created_at", monthStart).limit(5000),
    db.from("budget_reservations").select("resource,amount,job_ref,created_at").eq("workspace_id", ws).eq("status", "held"),
    db.from("quota_policies").select("scope,scope_id,resource,period,limit_amount").eq("enabled", true),
    db.from("platform_subscriptions").select("plan_id").eq("workspace_id", ws).maybeSingle(),
  ]);
  const charges = (ledger ?? []).filter((l) => l.kind === "charge");
  const sum = (res: string, f: (l: (typeof charges)[number]) => boolean = () => true) => charges.filter((l) => l.resource === res && f(l)).reduce((s, l) => s + Number(l.amount), 0);
  const held = (res: string) => (holds ?? []).filter((h) => h.resource === res).reduce((s, h) => s + Number(h.amount), 0);
  const mine = (pols ?? []).filter((p) => p.period === "month" && (p.scope === "org" ? p.scope_id === ws : p.scope === "brand" ? p.scope_id === B : p.scope === "user" ? p.scope_id === userId : p.scope === "plan" ? p.scope_id === sub?.plan_id : false));
  const RES: [string, string, boolean][] = [["claude_usd", "AI strategy & research (Claude)", true], ["research_requests", "Web searches", false], ["image_generations", "Images generated", false], ["video_generations", "Videos generated", false], ["media_usd", "Media generation spend (Higgsfield)", true]];
  return (
    <section className="panel">
      <h2>Usage this month</h2>
      <p className="muted">Resets {reset.toLocaleDateString("en-NG", { day: "numeric", month: "short" })}. AI tokens, searches and media generation are tracked separately. Figures marked “est.” are priced by us at the admin-set rate; Claude spend is measured from actual usage.</p>
      <div className="table-wrap"><table><thead><tr><th>Resource</th><th className="num">Used</th><th className="num">Held now</th><th className="num">Your limit</th><th className="num">Left</th></tr></thead><tbody>
        {RES.map(([k, label, money]) => {
          const used = sum(k), h = held(k);
          const lim = mine.filter((p) => p.resource === k).map((p) => Number(p.limit_amount)).sort((a, b) => a - b)[0];
          const f = (v: number) => (money ? `$${v.toFixed(2)}` : String(Math.round(v)));
          const est = charges.some((l) => l.resource === k && l.basis === "estimate");
          const warn = lim !== undefined && used + h >= lim * 0.8;
          return <tr key={k} className={warn ? "warn" : ""}><td>{label}</td><td className="num">{f(used)}{est ? " est." : ""}</td><td className="num">{f(h)}</td><td className="num">{lim !== undefined ? f(lim) : "Platform limit only"}</td><td className="num">{lim !== undefined ? f(Math.max(0, lim - used - h)) : "—"}{warn ? " ⚠️" : ""}</td></tr>;
        })}
      </tbody></table></div>
      <h3>By model</h3>
      <ul>{[...new Set(charges.map((c) => c.model).filter(Boolean))].map((m) => <li key={m}>{m}: {charges.filter((c) => c.model === m).length} charge(s)</li>)}</ul>
      <h3>Held budget</h3>
      {!(holds ?? []).length ? <p className="muted">Nothing held.</p> : <ul>{(holds ?? []).map((h, i) => <li key={i}><small>{h.resource} · {Number(h.amount)} · {h.job_ref.split(":")[0]} · since {new Date(h.created_at).toLocaleString("en-NG")}</small></li>)}</ul>}
    </section>
  );
}

async function Autopilot({ B, ws }: { B: string; ws: string }) {
  const db = supabaseAdmin();
  const [{ data: a }, { data: conns }, { data: posts }] = await Promise.all([
    db.from("creative_autopilot").select("*").eq("workspace_id", ws).maybeSingle(),
    db.from("channel_connections").select("provider,status").eq("workspace_id", ws).in("provider", ["facebook", "instagram"]),
    db.from("content_items").select("id,planned_date,platform,format,idea,publish_status,publish_at,published_at,publish_error").eq("brand_id", B).not("publish_status", "is", null).order("publish_at", { ascending: false }).limit(20),
  ]);
  const live = (p: string) => (conns ?? []).some((c) => c.provider === p && c.status === "active");
  const chans = (a?.channels as string[] | undefined) ?? ["facebook", "instagram"];
  return (
    <section className="panel">
      <h2>Autopilot</h2>
      <p className="muted">Your Creative Director runs the plan for you. You still approve each post idea; autopilot handles the rest on schedule.</p>
      <form action={A.saveAutopilot} className="cd-form">
        <input type="hidden" name="b" value={B} />
        <label className="row"><input type="checkbox" name="auto_plan" defaultChecked={a?.auto_plan} /> <span><b>Plan next month automatically</b> <small className="muted">On the 20th, draft next month&apos;s calendar from your approved strategy. You approve the ideas.</small></span></label>
        <label className="row"><input type="checkbox" name="auto_generate" defaultChecked={a?.auto_generate} /> <span><b>Create approved posts automatically</b> <small className="muted">3 days before each post, pick the best model and make the image or video, never above your cap.</small></span></label>
        <label className="field" style={{ maxWidth: 260 }}><span>Monthly creation cap (USD)</span><input name="cap" type="number" min={0} max={1000} step="0.5" className="input" defaultValue={Number(a?.monthly_media_cap_usd ?? 0)} /><small>0 = never spend automatically.</small></label>
        <label className="row"><input type="checkbox" name="auto_publish" defaultChecked={a?.auto_publish} /> <span><b>Post automatically</b> <small className="muted">Approved, finished posts go out on their planned date.</small></span></label>
        <div className="row wrap">
          <label className="row"><input type="checkbox" name="ch_facebook" defaultChecked={chans.includes("facebook")} /> Facebook Page {live("facebook") ? "" : <small className="hyp">(not connected)</small>}</label>
          <label className="row"><input type="checkbox" name="ch_instagram" defaultChecked={chans.includes("instagram")} /> Instagram {live("instagram") ? "" : <small className="hyp">(not connected)</small>}</label>
          <label className="row">Post at <input name="hour" type="number" min={0} max={23} className="input" style={{ width: 70 }} defaultValue={a?.publish_hour ?? 18} />:00 Lagos time</label>
        </div>
        <small className="muted">TikTok, X and WhatsApp Status can&apos;t be posted automatically yet: those stay in your calendar to post yourself.</small>
        <div><button className="btn btn-ink">Save autopilot</button></div>
      </form>
      <h3>Scheduled and posted</h3>
      {!posts?.length ? <p className="muted">Nothing scheduled yet. Finished posts appear here once autopilot posting is on.</p> : (
        <table className="table"><thead><tr><th>Date</th><th>Where</th><th>Post</th><th>Status</th></tr></thead><tbody>
          {posts.map((p) => <tr key={p.id}><td>{p.planned_date}</td><td>{p.platform}</td><td>{(p.idea as { hook?: string })?.hook}</td><td><Chip s={p.publish_status === "published" ? "completed" : p.publish_status === "failed" ? "failed" : "queued"} /> {p.publish_status}{p.publish_error ? <><br /><small>{p.publish_error}</small></> : null}</td></tr>)}
        </tbody></table>)}
    </section>
  );
}
