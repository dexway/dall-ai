import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireWorkspace, canManage } from "@/lib/workspace";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatNaira } from "@/lib/money";
import { GatewayError } from "@/lib/ai/gateway";
import { discoverProspects, researchProspect, draftOutreach, handleReply, draftProposal, suggestCompetitors, studyCompetitor } from "@/lib/harvey/agent";
import { STAGES, STAGE_LABEL, domainOf, mailtoLink, whatsappLink, type Signal, type Person } from "@/lib/harvey/signals";
import "./harvey.css";

export const metadata = { title: "Harvey · Sales agent" };

const go = (q: string) => redirect(`/dashboard/harvey?${q}`);
const why = (e: unknown) => encodeURIComponent((e instanceof GatewayError ? e.message : (e as Error).message ?? "Something went wrong.").slice(0, 240));

async function manager() {
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) go("error=role");
  return { ctx, a: { workspaceId: ctx.workspace.id, userId: ctx.user.id } };
}
async function owned(ws: string, id: string) {
  const { data } = await supabaseAdmin().from("harvey_prospects").select("id,stage").eq("id", id).eq("workspace_id", ws).maybeSingle();
  if (!data) go("error=notfound");
  return data!;
}
const run = (job: () => Promise<unknown>) => after(async () => { try { await job(); } catch (e) { console.error("[harvey]", (e as Error).message); } });

async function saveSetup(f: FormData) {
  "use server";
  const { ctx } = await manager();
  const s = (k: string, max = 600) => String(f.get(k) ?? "").trim().slice(0, max);
  await supabaseAdmin().from("harvey_settings").upsert({
    workspace_id: ctx.workspace.id, offer: s("offer", 1200), ideal_customers: s("ideal_customers"), areas: s("areas", 300), deciders: s("deciders", 300),
    proof: s("proof", 1000), sender_name: s("sender_name", 80), niche: s("niche", 300), differentiators: s("differentiators", 1200), followup_days: Math.min(21, Math.max(1, Number(f.get("followup_days")) || 3)),
    updated_by: ctx.user.id, updated_at: new Date().toISOString(),
  });
  revalidatePath("/dashboard/harvey");
  go("saved=setup");
}

async function competitorAct(f: FormData) {
  "use server";
  const { ctx, a } = await manager();
  const what = String(f.get("do") ?? "");
  const db = supabaseAdmin();
  if (what === "suggest") {
    let n = 0;
    try { n = await suggestCompetitors(a); } catch (e) { go(`error=ai&why=${why(e)}#competition`); }
    revalidatePath("/dashboard/harvey");
    go(`saved=suggested&n=${n}#competition`);
  }
  if (what === "add") {
    const name = String(f.get("name") ?? "").trim().slice(0, 120);
    if (name.length < 2) go("error=name#competition");
    const domain = domainOf(String(f.get("website") ?? "").trim());
    const { data, error } = await db.from("harvey_competitors").insert({ workspace_id: ctx.workspace.id, name, website: domain ? `https://${domain}` : null, domain }).select("id").single();
    if (error) go(`${error.code === "23505" ? "error=dup" : "error=save"}#competition`);
    run(() => studyCompetitor(a, data!.id));
  } else {
    const id = String(f.get("id") ?? "");
    const { data: c } = await db.from("harvey_competitors").select("id").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle();
    if (!c) go("error=notfound");
    if (what === "study") run(() => studyCompetitor(a, id));
    if (what === "remove") await db.from("harvey_competitors").delete().eq("id", id);
  }
  revalidatePath("/dashboard/harvey");
  go(`saved=${what === "remove" ? "1" : "studying"}#competition`);
}

async function findProspects() {
  "use server";
  const { a } = await manager();
  let n = 0;
  try { n = await discoverProspects(a, 10); } catch (e) { go(`error=ai&why=${why(e)}`); }
  revalidatePath("/dashboard/harvey");
  go(`saved=found&n=${n}`);
}

async function addProspect(f: FormData) {
  "use server";
  const { ctx, a } = await manager();
  const name = String(f.get("name") ?? "").trim().slice(0, 120);
  const website = String(f.get("website") ?? "").trim().slice(0, 300);
  if (name.length < 2) go("error=name");
  const domain = domainOf(website);
  const { data, error } = await supabaseAdmin().from("harvey_prospects").insert({
    workspace_id: ctx.workspace.id, name, website: domain ? `https://${domain}` : null, domain, source: "manual", created_by: ctx.user.id,
    email: String(f.get("email") ?? "").trim().slice(0, 160) || null, phone: String(f.get("phone") ?? "").trim().slice(0, 40) || null,
    whatsapp: String(f.get("phone") ?? "").trim().slice(0, 40) || null, contact_name: String(f.get("contact") ?? "").trim().slice(0, 80) || null,
  }).select("id").single();
  if (error) go(error.code === "23505" ? "error=dup" : "error=save");
  if (domain) run(() => researchProspect(a, data!.id));
  revalidatePath("/dashboard/harvey");
  go(`p=${data!.id}&saved=${domain ? "researching" : "added"}`);
}

async function act(f: FormData) {
  "use server";
  const { ctx, a } = await manager();
  const id = String(f.get("id") ?? ""), what = String(f.get("do") ?? "");
  const p = await owned(ctx.workspace.id, id);
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  if (what === "research") run(() => researchProspect(a, id));
  else if (what === "intro" || what === "followup") run(() => draftOutreach(a, id, what));
  else if (what === "proposal") run(() => draftProposal(a, id, String(f.get("notes") ?? "").slice(0, 800)));
  else if (what === "reply") {
    const text = String(f.get("reply") ?? "").trim();
    if (text.length < 2) go(`p=${id}&error=reply`);
    const ch = String(f.get("channel") ?? "email") as "email" | "whatsapp" | "call" | "other";
    run(() => handleReply(a, id, text, ["email", "whatsapp", "call", "other"].includes(ch) ? ch : "email"));
  } else if (what === "sent") {
    const mid = String(f.get("mid") ?? "");
    const { data: m } = await db.from("harvey_messages").update({ status: "sent", sent_at: now }).eq("id", mid).eq("prospect_id", id).eq("status", "draft").select("kind").maybeSingle();
    if (m) {
      // The other channel's version of the same draft is no longer needed.
      await db.from("harvey_messages").update({ status: "discarded" }).eq("prospect_id", id).eq("status", "draft").eq("kind", m.kind);
      const stage = m.kind === "proposal" ? "proposal" : ["new", "researched", "drafted"].includes(p.stage) ? "contacted" : p.stage;
      await db.from("harvey_prospects").update({ stage, updated_at: now }).eq("id", id);
    }
  } else if (what === "discard") {
    await db.from("harvey_messages").update({ status: "discarded" }).eq("id", String(f.get("mid") ?? "")).eq("prospect_id", id).eq("status", "draft");
  } else if (what === "deal") {
    const stage = String(f.get("stage") ?? "");
    const value = Number(f.get("value"));
    const at = String(f.get("next_at") ?? "");
    await db.from("harvey_prospects").update({
      ...(STAGES.includes(stage as never) ? { stage } : {}),
      value_kobo: Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null,
      next_step: String(f.get("next_step") ?? "").trim().slice(0, 200) || null,
      next_at: at ? new Date(`${at}T09:00:00+01:00`).toISOString() : null,
      lost_reason: stage === "lost" ? String(f.get("lost_reason") ?? "").trim().slice(0, 200) || null : null,
      notes: String(f.get("notes") ?? "").slice(0, 2000) || null, updated_at: now,
    }).eq("id", id);
  } else if (what === "delete") {
    await db.from("harvey_prospects").delete().eq("id", id).eq("workspace_id", ctx.workspace.id);
    revalidatePath("/dashboard/harvey");
    go("saved=deleted");
  }
  revalidatePath("/dashboard/harvey");
  go(`p=${id}&saved=${["research", "intro", "followup", "proposal", "reply"].includes(what) ? "working" : "1"}`);
}

type Research = { summary?: string; fit_reason?: string; angle?: string; decider?: { name: string; title: string; why: string }; risks?: string[]; signals?: Signal[]; people?: Person[]; pages?: { url: string; title: string }[] };

const ERR: Record<string, string> = { role: "Only owners and admins can use Harvey.", notfound: "That prospect isn't in this business.", name: "Give the prospect a name.", dup: "That website is already in your pipeline.", save: "Couldn't save. Try again.", ai: "Harvey couldn't finish that", reply: "Paste the reply first." };
const OK: Record<string, string> = { studying: "Harvey is studying that competitor: their site, prices and public reviews. Refresh in a minute.", setup: "Saved. Harvey sells with this from now on.", added: "Prospect added.", researching: "Prospect added. Harvey is reading their website; refresh in a minute.", working: "Harvey is on it. Refresh in a few seconds to see the result.", deleted: "Prospect removed.", "1": "Saved." };

export default async function HarveyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireWorkspace();
  const sp = await searchParams;
  const db = supabaseAdmin();
  const ws = ctx.workspace.id;
  const [{ data: s, error: setupErr }, { data: prospects }, { data: competitors }] = await Promise.all([
    db.from("harvey_settings").select("*").eq("workspace_id", ws).maybeSingle(),
    db.from("harvey_prospects").select("id,name,website,stage,fit,value_kobo,next_step,next_at,research,error,updated_at,contact_name,competitor_id").eq("workspace_id", ws).order("updated_at", { ascending: false }).limit(300),
    db.from("harvey_competitors").select("*").eq("workspace_id", ws).order("created_at"),
  ]);
  const rivals = new Map((competitors ?? []).map((c) => [c.id, c.name as string]));
  if (setupErr) return <div className="page-head"><div><h1>Harvey</h1><p>Harvey, your sales agent, is waiting for a one-time database setup.</p></div></div>;

  const list = prospects ?? [];
  const stage = STAGES.includes(sp.stage as never) ? sp.stage : "";
  const shown = stage ? list.filter((p) => p.stage === stage) : list.filter((p) => p.stage !== "lost");
  const open = list.filter((p) => !["won", "lost"].includes(p.stage));
  const pipeline = open.reduce((t, p) => t + Number(p.value_kobo ?? 0), 0);
  const won = list.filter((p) => p.stage === "won").reduce((t, p) => t + Number(p.value_kobo ?? 0), 0);
  const due = open.filter((p) => p.next_at && Date.parse(p.next_at) <= Date.now() + 86_400_000);
  const sel = sp.p ? list.find((p) => p.id === sp.p) : null;
  const ready = Boolean(s?.offer && s?.ideal_customers);

  return (
    <div className="hv-page">
      <div className="page-head">
        <div><h1>Harvey <span className="hv-badge">Sales agent</span></h1>
          <p>Harvey finds customers worth selling to, learns something real about each one, writes the outreach, follows up, answers replies and drafts proposals, all the way to a closed deal. You approve every message and send it in one tap from your own email or WhatsApp.</p></div>
      </div>
      {sp.error && <div className="notice notice-bad" role="alert">{ERR[sp.error] ?? "Something went wrong."}{sp.why ? `: ${decodeURIComponent(sp.why)}` : "."}</div>}
      {sp.saved && <div className="notice notice-ok" role="status">{sp.saved === "suggested" ? `Harvey suggested ${sp.n ?? 0} competitor${sp.n === "1" ? "" : "s"}. Study them so it can go after their customers.` : sp.saved === "found" ? `Harvey found ${sp.n ?? 0} new prospect${sp.n === "1" ? "" : "s"}. Open one to research it.` : OK[sp.saved] ?? "Saved."}</div>}

      <div className="stats">
        <div className="stat"><span>Open deals</span><b>{open.length}</b></div>
        <div className="stat"><span>Pipeline value</span><b>{formatNaira(pipeline)}</b></div>
        <div className="stat"><span>Won</span><b>{formatNaira(won)}</b></div>
        <div className="stat"><span>Follow-ups due</span><b>{due.length}</b></div>
      </div>

      <details className="panel" open={!ready}>
        <summary><b>{ready ? "What Harvey is selling" : "1 · Tell Harvey what to sell"}</b></summary>
        <form action={saveSetup} className="hv-form">
          <label className="field"><span>What you sell to these customers</span><textarea name="offer" rows={3} className="input" defaultValue={s?.offer} placeholder="Corporate event packages: conference hall for 50–300, catering, AV, rooms for out-of-town guests." required /></label>
          <div className="hv-grid">
            <label className="field"><span>Your niche</span><input name="niche" className="input" defaultValue={s?.niche} placeholder="Corporate event venues in Lekki and VI" /></label>
            <label className="field"><span>Why customers pick you over competitors</span><input name="differentiators" className="input" defaultValue={s?.differentiators} placeholder="On-site parking for 200 cars, in-house caterer, 24h power" /></label>
          </div>
          <label className="field"><span>Ideal customers</span><input name="ideal_customers" className="input" defaultValue={s?.ideal_customers} placeholder="Corporate offices, banks, NGOs, event planners, embassies" required /></label>
          <div className="hv-grid">
            <label className="field"><span>Areas</span><input name="areas" className="input" defaultValue={s?.areas} placeholder="Lekki, Victoria Island, Ikoyi" /></label>
            <label className="field"><span>Who usually decides</span><input name="deciders" className="input" defaultValue={s?.deciders} placeholder="Admin manager, HR, office manager" /></label>
          </div>
          <label className="field"><span>Proof you can mention (real results, clients, reviews)</span><textarea name="proof" rows={2} className="input" defaultValue={s?.proof} placeholder="Hosted Access Bank's 2025 retreat; 4.8★ on Google from 320 reviews" /></label>
          <div className="hv-grid">
            <label className="field"><span>Sign messages as</span><input name="sender_name" className="input" defaultValue={s?.sender_name} placeholder="Tola, Sales Manager" /></label>
            <label className="field"><span>Follow up after (days)</span><input name="followup_days" type="number" min={1} max={21} className="input" defaultValue={s?.followup_days ?? 3} /></label>
          </div>
          <div><button className="btn btn-ink">Save</button></div>
        </form>
      </details>

      <section className="panel" id="competition">
        <div className="hv-toolbar">
          <div><h2>Your competition</h2><small className="muted">Harvey studies each competitor, spots prospects already working with them, and writes honest reasons to switch.</small></div>
          <form action={competitorAct}><input type="hidden" name="do" value="suggest" /><button className="btn btn-line" disabled={!ready}>Suggest competitors</button></form>
        </div>
        {!(competitors ?? []).length ? <p className="muted">No competitors yet. Let Harvey suggest them for your niche, or add the ones you know.</p> : (
          <div className="hv-rivals">{(competitors ?? []).map((c) => { const i = (c.intel ?? {}) as { offer?: string; positioning?: string; prices?: { item: string; price: string }[]; weaknesses?: { point: string; source: string }[]; clients?: string[]; switch_angle?: string }; const n = list.filter((p) => p.competitor_id === c.id).length; return (
            <article key={c.id} className="hv-rival">
              <header><b>{c.name}</b>{c.domain && <> · <a href={c.website ?? "#"} target="_blank" rel="noopener noreferrer"><small>{c.domain}</small></a></>}<span className={`hv-stage st-${c.status === "ready" ? "won" : c.status === "failed" ? "lost" : "contacted"}`}>{c.status === "ready" ? "Studied" : c.status === "studying" ? "Studying…" : c.status === "failed" ? "Failed" : "Not studied"}</span></header>
              {c.error && <small className="hyp">{c.error}</small>}
              {i.offer && <p><small>{i.offer}</small></p>}
              {i.prices?.length ? <p><small><b>Prices seen:</b> {i.prices.map((x) => `${x.item} ${x.price}`).join(" · ")}</small></p> : null}
              {i.weaknesses?.length ? <ul className="hv-weak">{i.weaknesses.map((w) => <li key={w.point}><small>{w.point} · <a href={w.source} target="_blank" rel="noopener noreferrer">source</a></small></li>)}</ul> : null}
              {i.switch_angle && <p><small><b>Why switch to you:</b> {i.switch_angle}</small></p>}
              <p><small className="muted">{i.clients?.length ? `${i.clients.length} public client${i.clients.length === 1 ? "" : "s"} found · ` : ""}{n} of your prospects work with them</small></p>
              <div className="row">
                <form action={competitorAct}><input type="hidden" name="do" value="study" /><input type="hidden" name="id" value={c.id} /><button className="btn btn-line btn-sm">{c.status === "ready" ? "Study again" : "Study"}</button></form>
                <form action={competitorAct}><input type="hidden" name="do" value="remove" /><input type="hidden" name="id" value={c.id} /><button className="btn btn-line btn-sm">Remove</button></form>
              </div>
            </article>); })}</div>
        )}
        <form action={competitorAct} className="hv-grid" style={{ marginTop: 10 }}>
          <input type="hidden" name="do" value="add" />
          <label className="field"><span>Competitor name</span><input name="name" className="input" required /></label>
          <label className="field"><span>Their website</span><input name="website" className="input" placeholder="theirsite.com" /></label>
          <div style={{ alignSelf: "end" }}><button className="btn btn-ink">Add and study</button></div>
        </form>
      </section>

      <section className="panel">
        <div className="hv-toolbar">
          <h2>Pipeline</h2>
          <form action={findProspects}><button className="btn btn-lime" disabled={!ready}>🔎 Find 10 prospects</button></form>
        </div>
        <nav className="hv-stages" aria-label="Filter by stage">
          <Link href="/dashboard/harvey" className={`pill ${!stage ? "on" : ""}`}>All open</Link>
          {STAGES.map((st) => { const n = list.filter((p) => p.stage === st).length; return <Link key={st} href={`/dashboard/harvey?stage=${st}`} className={`pill ${stage === st ? "on" : ""}`}>{STAGE_LABEL[st]} {n ? <small>{n}</small> : null}</Link>; })}
        </nav>
        {!shown.length ? <p className="muted">{ready ? "No prospects here yet. Let Harvey find some, or add one you already know below." : "Tell Harvey what you sell first, then it can find prospects."}</p> : (
          <div className="table-wrap"><table><thead><tr><th>Prospect</th><th>Stage</th><th className="num">Fit</th><th>Why now</th><th>Next step</th><th className="num">Value</th></tr></thead><tbody>
            {shown.map((p) => { const r = (p.research ?? {}) as Research; return (
              <tr key={p.id} className={sel?.id === p.id ? "hv-sel" : ""}>
                <td><Link href={`/dashboard/harvey?p=${p.id}${stage ? `&stage=${stage}` : ""}#deal`}><b>{p.name}</b></Link><br /><small className="muted">{p.contact_name ?? domainOf(p.website) ?? ""}</small>{p.competitor_id && rivals.get(p.competitor_id) ? <><br /><span className="hv-uses">Uses {rivals.get(p.competitor_id)}</span></> : null}</td>
                <td><span className={`hv-stage st-${p.stage}`}>{STAGE_LABEL[p.stage as keyof typeof STAGE_LABEL]}</span></td>
                <td className="num">{p.fit ?? "–"}</td>
                <td><small>{p.error ? <span className="hyp">{p.error}</span> : r.angle ?? r.signals?.[0]?.label ?? "Not researched yet"}</small></td>
                <td><small>{p.next_step ?? ""}{p.next_at ? ` · ${new Date(p.next_at).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}` : ""}</small></td>
                <td className="num">{p.value_kobo ? formatNaira(Number(p.value_kobo)) : ""}</td>
              </tr>); })}
          </tbody></table></div>
        )}
        <details style={{ marginTop: 10 }}>
          <summary>+ Add a prospect you already know</summary>
          <form action={addProspect} className="hv-grid" style={{ marginTop: 8 }}>
            <label className="field"><span>Business name</span><input name="name" className="input" required /></label>
            <label className="field"><span>Website</span><input name="website" className="input" placeholder="theircompany.com" /></label>
            <label className="field"><span>Contact person</span><input name="contact" className="input" /></label>
            <label className="field"><span>Email</span><input name="email" type="email" className="input" /></label>
            <label className="field"><span>Phone / WhatsApp</span><input name="phone" className="input" /></label>
            <div style={{ alignSelf: "end" }}><button className="btn btn-ink">Add and research</button></div>
          </form>
        </details>
      </section>

      {sel && <Deal id={sel.id} ws={ws} />}
    </div>
  );
}

async function Deal({ id, ws }: { id: string; ws: string }) {
  const db = supabaseAdmin();
  const [{ data: p }, { data: msgs }] = await Promise.all([
    db.from("harvey_prospects").select("*").eq("id", id).eq("workspace_id", ws).single(),
    db.from("harvey_messages").select("*").eq("prospect_id", id).neq("status", "discarded").order("created_at"),
  ]);
  if (!p) return null;
  const r = (p.research ?? {}) as Research;
  const drafts = (msgs ?? []).filter((m) => m.status === "draft");
  const thread = (msgs ?? []).filter((m) => m.status !== "draft");
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  const Btn = ({ d, label, cls = "btn-line" }: { d: string; label: string; cls?: string }) => <form action={act}>{hidden("id", p.id)}{hidden("do", d)}<button className={`btn ${cls} btn-sm`}>{label}</button></form>;
  return (
    <section className="panel hv-deal" id="deal">
      <div className="hv-toolbar">
        <div><h2 style={{ margin: 0 }}>{p.name}</h2><small className="muted">{p.website ? <a href={p.website} target="_blank" rel="noopener noreferrer">{domainOf(p.website)}</a> : "No website"}{p.contact_name ? ` · ${p.contact_name}${p.contact_title ? `, ${p.contact_title}` : ""}` : ""}</small></div>
        <span className={`hv-stage st-${p.stage}`}>{STAGE_LABEL[p.stage as keyof typeof STAGE_LABEL]}</span>
      </div>
      {p.error && <p className="hyp">Last attempt failed: {p.error}</p>}

      <div className="hv-cols">
        <div>
          <h3>Research</h3>
          {r.summary ? <>
            <p>{r.summary}</p>
            {r.angle && <p><b>Why reach out now:</b> {r.angle}</p>}
            {p.fit != null && <p><b>Fit {p.fit}/100.</b> {r.fit_reason}</p>}
            {r.signals?.length ? <ul className="hv-signals">{r.signals.map((sg) => <li key={sg.key}><b>{sg.label}</b><br /><small>“{sg.evidence}” · <a href={sg.url} target="_blank" rel="noopener noreferrer">source</a></small></li>)}</ul> : <p className="muted">No buying signals found on their site.</p>}
            {r.people?.length ? <p><small><b>People on their site:</b> {r.people.map((x) => `${x.name} (${x.title})`).join(", ")}</small></p> : null}
            {r.risks?.length ? <p><small><b>Watch out:</b> {r.risks.join(" · ")}</small></p> : null}
          </> : <p className="muted">{p.website ? "Not researched yet." : "Add their website to research them, or write to them directly."}</p>}
          <p><small><b>Email:</b> {p.email ?? "not found"} · <b>Phone:</b> {p.phone ?? "not found"}{p.whatsapp && p.whatsapp !== p.phone ? ` · WhatsApp ${p.whatsapp}` : ""}</small></p>
          <div className="row wrap">
            {p.website && <Btn d="research" label={r.summary ? "Research again" : "Research"} />}
            <Btn d="intro" label="Write first message" cls="btn-ink" />
            <Btn d="followup" label="Write follow-up" />
          </div>
        </div>

        <div>
          <h3>Deal</h3>
          <form action={act} className="hv-form">
            {hidden("id", p.id)}{hidden("do", "deal")}
            <div className="hv-grid">
              <label className="field"><span>Stage</span><select name="stage" className="input" defaultValue={p.stage}>{STAGES.map((st) => <option key={st} value={st}>{STAGE_LABEL[st]}</option>)}</select></label>
              <label className="field"><span>Deal value (₦)</span><input name="value" type="number" min={0} step="any" className="input" defaultValue={p.value_kobo ? Number(p.value_kobo) / 100 : ""} /></label>
            </div>
            <div className="hv-grid">
              <label className="field"><span>Next step</span><input name="next_step" className="input" defaultValue={p.next_step ?? ""} /></label>
              <label className="field"><span>By</span><input name="next_at" type="date" className="input" defaultValue={p.next_at ? new Date(p.next_at).toISOString().slice(0, 10) : ""} /></label>
            </div>
            <label className="field"><span>If lost, why</span><input name="lost_reason" className="input" defaultValue={p.lost_reason ?? ""} /></label>
            <label className="field"><span>Notes</span><textarea name="notes" rows={2} className="input" defaultValue={p.notes ?? ""} /></label>
            <div className="row"><button className="btn btn-ink btn-sm">Save deal</button></div>
          </form>
        </div>
      </div>

      {drafts.length > 0 && <>
        <h3>Ready for you to send</h3>
        <div className="hv-drafts">
          {drafts.map((m) => {
            const link = m.channel === "whatsapp" ? (p.whatsapp || p.phone ? whatsappLink(p.whatsapp || p.phone, m.body) : null) : p.email ? mailtoLink(p.email, m.subject ?? "", m.body) : null;
            return (
              <article key={m.id} className="hv-draft">
                <header><b>{m.channel === "whatsapp" ? "WhatsApp" : "Email"}</b> · {m.kind}</header>
                {m.subject && <p><small><b>Subject:</b> {m.subject}</small></p>}
                <p className="hv-body">{m.body}</p>
                <div className="row wrap">
                  {link ? <a className="btn btn-lime btn-sm" href={link} target="_blank" rel="noopener noreferrer">{m.channel === "whatsapp" ? "Open in WhatsApp" : "Open in email"}</a> : <small className="hyp">No {m.channel === "whatsapp" ? "phone number" : "email address"} yet: add it in the deal or copy the text.</small>}
                  <form action={act}>{hidden("id", p.id)}{hidden("do", "sent")}{hidden("mid", m.id)}<button className="btn btn-ink btn-sm">I sent it</button></form>
                  <form action={act}>{hidden("id", p.id)}{hidden("do", "discard")}{hidden("mid", m.id)}<button className="btn btn-line btn-sm">Discard</button></form>
                </div>
              </article>
            );
          })}
        </div>
      </>}

      <div className="hv-cols">
        <form action={act} className="hv-form">
          {hidden("id", p.id)}{hidden("do", "reply")}
          <h3>They replied?</h3>
          <textarea name="reply" rows={4} className="input" placeholder="Paste their reply, or notes from a call. Harvey reads it, suggests the next stage and drafts your answer." />
          <div className="row"><select name="channel" className="input" style={{ maxWidth: 160 }}><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="call">Call / meeting</option><option value="other">Other</option></select><button className="btn btn-ink btn-sm">Let Harvey handle it</button></div>
        </form>
        <form action={act} className="hv-form">
          {hidden("id", p.id)}{hidden("do", "proposal")}
          <h3>Proposal</h3>
          <textarea name="notes" rows={4} className="input" placeholder="What they need (dates, numbers, budget). Harvey prices it from your catalogue." />
          <div className="row"><button className="btn btn-ink btn-sm">Write proposal</button></div>
        </form>
      </div>

      {thread.length > 0 && <>
        <h3>Conversation</h3>
        <ol className="hv-thread">{thread.map((m) => (
          <li key={m.id} className={m.direction === "in" ? "in" : "out"}>
            <small>{m.direction === "in" ? "They" : "You"} · {m.channel} · {new Date(m.sent_at ?? m.created_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}{m.meta?.intent ? ` · ${String(m.meta.intent).replace("_", " ")}` : ""}</small>
            {m.subject && <b>{m.subject}</b>}
            <p className="hv-body">{m.body}</p>
            {m.meta?.summary && <small className="muted">Harvey: {m.meta.summary}</small>}
          </li>))}</ol>
      </>}

      <form action={act} style={{ marginTop: 12 }}>{hidden("id", p.id)}{hidden("do", "delete")}<button className="btn btn-line btn-sm">Remove from pipeline</button></form>
    </section>
  );
}
