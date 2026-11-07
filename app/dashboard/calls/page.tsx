import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireWorkspace, canManage } from "@/lib/workspace";
import { supabaseAdmin } from "@/lib/supabase/server";
import { VOICES, VOICE_COUNTRIES, isVoice, parseContacts, toE164 } from "@/lib/voice/rules";
import { searchNumbers, telecomLive, voiceLive, type AvailableNumber } from "@/lib/voice/providers";
import { syncVoiceAgent, provisionNumber, releaseVoiceNumber, startSingleCall, runVoiceCampaigns, friendlyError } from "@/lib/voice/service";

export const metadata = { title: "Calls" };
export const maxDuration = 60;

// AI phone calls: get a number, your assistant answers and calls in your business's name, and call
// campaigns work through a contact list within the limits you set.

const TABS = [["numbers", "Numbers"], ["agent", "Voice agent"], ["calls", "Calls"], ["campaigns", "Campaigns"]] as const;
const go = (tab: string, q = "") => redirect(`/dashboard/calls?tab=${tab}${q ? `&${q}` : ""}`);
const STATUS_LABEL: Record<string, string> = { queued: "Waiting", dialing: "Ringing", in_progress: "On the call", completed: "Completed", no_answer: "No answer", busy: "Busy", failed: "Failed", cancelled: "Cancelled" };

async function manager() {
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) go("numbers", "error=Only+owners+and+admins+can+manage+calls.");
  return ctx;
}
const fail = (tab: string, e: unknown) => go(tab, `error=${encodeURIComponent(friendlyError(e).slice(0, 200))}`);
const rethrowRedirect = (e: unknown) => { if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e; };

async function buy(formData: FormData) {
  "use server";
  const ctx = await manager();
  const e164 = toE164(String(formData.get("number") ?? ""), "US");
  const country = String(formData.get("country") ?? "NG");
  if (!e164 || formData.get("confirm") !== "yes") go("numbers", "error=Tick+the+box+to+confirm+you+want+this+number.");
  try { await provisionNumber(ctx.workspace.id, ctx.user.id, e164!, country); }
  catch (e) { rethrowRedirect(e); fail("numbers", e); }
  revalidatePath("/dashboard/calls");
  go("numbers", "ok=number");
}

async function release(formData: FormData) {
  "use server";
  const ctx = await manager();
  try { await releaseVoiceNumber(ctx.workspace.id, String(formData.get("id") ?? "")); }
  catch (e) { rethrowRedirect(e); fail("numbers", e); }
  revalidatePath("/dashboard/calls");
  go("numbers", "ok=released");
}

async function saveAgent(formData: FormData) {
  "use server";
  const ctx = await manager();
  const voice = String(formData.get("voice") ?? "");
  try {
    await syncVoiceAgent(ctx.workspace.id, {
      name: String(formData.get("name") ?? "").trim().slice(0, 40) || undefined,
      voice: isVoice(voice) ? voice : undefined,
      firstMessage: String(formData.get("first_message") ?? "").trim().slice(0, 500) || undefined,
      instructions: String(formData.get("instructions") ?? "").trim().slice(0, 3000),
    });
  } catch (e) { rethrowRedirect(e); fail("agent", e); }
  revalidatePath("/dashboard/calls");
  go("agent", "ok=agent");
}

async function callOne(formData: FormData) {
  "use server";
  const ctx = await manager();
  const to = toE164(String(formData.get("to") ?? ""));
  const numberId = String(formData.get("number_id") ?? "");
  if (!to) go("calls", "error=Enter+a+valid+phone+number.");
  try { await startSingleCall(ctx.workspace.id, ctx.user.id, numberId, to!, String(formData.get("name") ?? "").trim().slice(0, 80) || null); }
  catch (e) { rethrowRedirect(e); fail("calls", e); }
  revalidatePath("/dashboard/calls");
  go("calls", "ok=call");
}

async function createCampaign(formData: FormData) {
  "use server";
  const ctx = await manager();
  const db = supabaseAdmin();
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const numberId = String(formData.get("number_id") ?? "");
  const { contacts, rejected } = parseContacts(String(formData.get("contacts") ?? ""));
  const maxMinutes = Math.min(10000, Math.max(1, Number(formData.get("max_minutes")) || 30));
  const maxConcurrent = Math.min(10, Math.max(1, Number(formData.get("max_concurrent")) || 1));
  if (name.length < 2 || !contacts.length) go("campaigns", "error=Give+the+campaign+a+name+and+at+least+one+valid+number.");
  if (formData.get("confirm") !== "yes") go("campaigns", "error=Tick+the+box+to+confirm+these+people+agreed+to+be+called.");
  const { data: camp, error } = await db.from("voice_campaigns").insert({
    workspace_id: ctx.workspace.id, name, number_id: numberId, goal: String(formData.get("goal") ?? "").trim().slice(0, 500),
    max_minutes: maxMinutes, max_concurrent: maxConcurrent, status: formData.get("start") === "now" ? "running" : "draft", created_by: ctx.user.id,
  }).select("id,status").single();
  if (error) go("campaigns", `error=${encodeURIComponent(error.message)}`);
  await db.from("voice_calls").insert(contacts.map((c) => ({ workspace_id: ctx.workspace.id, number_id: numberId, campaign_id: camp!.id, to_e164: c.e164, contact_name: c.name, created_by: ctx.user.id })));
  if (camp!.status === "running") after(() => runVoiceCampaigns(20_000).then(() => undefined));
  revalidatePath("/dashboard/calls");
  go("campaigns", `ok=campaign${rejected.length ? `&skipped=${rejected.length}` : ""}`);
}

async function setCampaign(formData: FormData) {
  "use server";
  const ctx = await manager();
  const to = String(formData.get("to") ?? "");
  if (!["running", "paused"].includes(to)) go("campaigns");
  await supabaseAdmin().from("voice_campaigns").update({ status: to }).eq("id", String(formData.get("id") ?? "")).eq("workspace_id", ctx.workspace.id).in("status", ["draft", "running", "paused"]);
  if (to === "running") after(() => runVoiceCampaigns(20_000).then(() => undefined));
  revalidatePath("/dashboard/calls");
  go("campaigns");
}

export default async function CallsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireWorkspace();
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "numbers";
  const db = supabaseAdmin();
  const ws = ctx.workspace.id;
  const [{ data: numbers, error: setupErr }, { data: agent }, { data: calls }, { data: campaigns }] = await Promise.all([
    db.from("voice_numbers").select("id,e164,country,status,error,created_at").eq("workspace_id", ws).neq("status", "released").order("created_at", { ascending: false }),
    db.from("voice_agents").select("name,voice,first_message,instructions,synced_at").eq("workspace_id", ws).maybeSingle(),
    db.from("voice_calls").select("id,to_e164,contact_name,status,duration_s,summary,transcript,recording_url,error,created_at,campaign_id").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(50),
    db.from("voice_campaigns").select("id,name,status,goal,max_minutes,minutes_used,max_concurrent,created_at").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(20),
  ]);
  if (setupErr) return <section className="panel"><h1>Calls</h1><p className="muted">Calls are being set up. Check back shortly.</p></section>;
  const active = (numbers ?? []).filter((n) => n.status === "active");
  const testMode = !telecomLive() || !voiceLive();

  let available: AvailableNumber[] = [];
  let searchError = "";
  if (tab === "numbers" && sp.country) {
    try { available = await searchNumbers(sp.country, sp.contains); } catch (e) { searchError = friendlyError(e); }
  }
  const counts = new Map<string, Record<string, number>>();
  for (const c of calls ?? []) if (c.campaign_id) { const m = counts.get(c.campaign_id) ?? {}; m[c.status] = (m[c.status] ?? 0) + 1; counts.set(c.campaign_id, m); }

  return (
    <>
      <div className="page-head">
        <div><h1>Calls</h1><p>Get a phone number in minutes. Your assistant answers it, calls customers for you, and runs call campaigns, all in your business&apos;s name.</p></div>
      </div>
      {testMode && (telecomLive() || voiceLive()
        ? <div className="notice">Calling is being switched on. You can look around, but getting a number and calling will open shortly.</div>
        : <div className="notice">Calling is in test mode: you can try every step, but no real number is bought and no one is dialled.</div>)}
      {sp.error && <div className="notice notice-bad" role="alert">{sp.error}</div>}
      {sp.ok && <div className="notice notice-ok">{{ number: "Your number is ready. Your assistant now answers it.", released: "Number released.", agent: "Voice agent saved.", call: "Calling now. The result appears below.", campaign: `Campaign created.${sp.skipped ? ` ${sp.skipped} line(s) skipped (not a valid number).` : ""}` }[sp.ok] ?? "Saved."}</div>}

      <nav className="cd-tabs" style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
        {TABS.map(([k, label]) => <Link key={k} href={`/dashboard/calls?tab=${k}`} className={`pill ${tab === k ? "on" : ""}`} aria-current={tab === k ? "page" : undefined}>{label}</Link>)}
      </nav>

      {tab === "numbers" && (
        <>
          <section className="panel">
            <h2>Your numbers</h2>
            {!(numbers ?? []).length && <p className="muted">No number yet. Find one below.</p>}
            <ul className="ci-list">{(numbers ?? []).map((n) => (
              <li key={n.id} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <b>{n.e164}</b> <small className="muted">{n.country} · {n.status === "active" ? "Active" : n.status === "provisioning" ? "Setting up…" : "Failed"}</small>
                {n.error && <small style={{ color: "#a33" }}>{n.error}</small>}
                <form action={release}><input type="hidden" name="id" value={n.id} /><button className="btn btn-line btn-sm">Release</button></form>
              </li>
            ))}</ul>
          </section>
          <section className="panel">
            <h2>Get a number</h2>
            <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
              <input type="hidden" name="tab" value="numbers" />
              <label className="field"><span>Country</span><select name="country" className="input" defaultValue={sp.country ?? "NG"}>{VOICE_COUNTRIES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select></label>
              <label className="field"><span>Contains digits (optional)</span><input name="contains" className="input" inputMode="numeric" maxLength={8} defaultValue={sp.contains ?? ""} /></label>
              <button className="btn btn-ink">Show available numbers</button>
            </form>
            {searchError && <p className="notice notice-bad">{searchError}</p>}
            {sp.country && !searchError && !available.length && <p className="muted">No numbers available right now. Try another country.</p>}
            {available.length > 0 && <ul className="ci-list" style={{ marginTop: 12 }}>{available.map((a) => (
              <li key={a.number}>
                <form action={buy} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <input type="hidden" name="number" value={a.number} /><input type="hidden" name="country" value={a.country} />
                  <b>{a.number}</b>{a.monthlyCost && <small className="muted">{a.monthlyCost}/month</small>}
                  <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 13 }}><input type="checkbox" name="confirm" value="yes" /> I want this number</label>
                  <button className="btn btn-lime btn-sm">Get this number</button>
                </form>
              </li>
            ))}</ul>}
          </section>
        </>
      )}

      {tab === "agent" && (
        <section className="panel">
          <h2>Voice agent</h2>
          <p className="muted">Your voice agent uses everything your chat assistant knows: your products, prices, website and rules. Saving updates it on every number straight away.</p>
          <form action={saveAgent} className="cd-form">
            <label className="field"><span>Name it says on calls</span><input name="name" className="input" maxLength={40} defaultValue={agent?.name ?? ""} placeholder="Amaka" /></label>
            <label className="field"><span>Voice</span><select name="voice" className="input" defaultValue={agent?.voice ?? "female_ng"}>{VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
            <label className="field"><span>First thing it says</span><input name="first_message" className="input" maxLength={500} defaultValue={agent?.first_message ?? ""} placeholder={`Hello, this is your assistant from ${ctx.workspace.name}. How are you today?`} /></label>
            <label className="field"><span>Extra instructions for calls (optional)</span><textarea name="instructions" className="input" rows={4} maxLength={3000} defaultValue={agent?.instructions ?? ""} placeholder="e.g. Ask for their check-in date and number of guests. Offer the Super Premium room first." /></label>
            <button className="btn btn-lime">{agent ? "Save voice agent" : "Create voice agent"}</button>
            {agent?.synced_at && <small className="muted"> Last updated {new Date(agent.synced_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</small>}
          </form>
        </section>
      )}

      {tab === "calls" && (
        <>
          <section className="panel">
            <h2>Make a call</h2>
            {!active.length ? <p className="muted">Get a number first (Numbers tab).</p> : (
              <form action={callOne} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
                <label className="field"><span>From</span><select name="number_id" className="input">{active.map((n) => <option key={n.id} value={n.id}>{n.e164}</option>)}</select></label>
                <label className="field"><span>Call this number</span><input name="to" className="input" inputMode="tel" required placeholder="0803 123 4567" /></label>
                <label className="field"><span>Their name (optional)</span><input name="name" className="input" maxLength={80} /></label>
                <button className="btn btn-lime">Call now</button>
              </form>
            )}
            <p className="muted" style={{ fontSize: 13 }}>Tip: call your own phone first to hear your agent.</p>
          </section>
          <section className="panel">
            <h2>Recent calls</h2>
            {!(calls ?? []).length && <p className="muted">No calls yet.</p>}
            <ul className="ci-list">{(calls ?? []).map((c) => (
              <li key={c.id} style={{ marginBottom: 10 }}>
                <b>{c.contact_name ? `${c.contact_name} · ` : ""}{c.to_e164}</b> <small className="muted">{STATUS_LABEL[c.status] ?? c.status}{c.duration_s ? ` · ${Math.floor(c.duration_s / 60)}m ${c.duration_s % 60}s` : ""} · {new Date(c.created_at).toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" })}</small>
                {c.error && <><br /><small style={{ color: "#a33" }}>{c.error}</small></>}
                {c.summary && <p style={{ margin: "4px 0" }}>{c.summary}</p>}
                {c.recording_url && <audio controls preload="none" src={c.recording_url} style={{ width: "100%", maxWidth: 420 }} />}
                {c.transcript && <details><summary>Transcript</summary><pre style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{c.transcript}</pre></details>}
              </li>
            ))}</ul>
          </section>
        </>
      )}

      {tab === "campaigns" && (
        <>
          <section className="panel">
            <h2>New call campaign</h2>
            {!active.length ? <p className="muted">Get a number first (Numbers tab).</p> : (
              <form action={createCampaign} className="cd-form">
                <div className="grid3">
                  <label className="field"><span>Campaign name</span><input name="name" className="input" required minLength={2} maxLength={80} placeholder="December room offer" /></label>
                  <label className="field"><span>Call from</span><select name="number_id" className="input">{active.map((n) => <option key={n.id} value={n.id}>{n.e164}</option>)}</select></label>
                  <label className="field"><span>Calls at the same time</span><input name="max_concurrent" type="number" min={1} max={10} defaultValue={1} className="input" /></label>
                </div>
                <label className="field"><span>What should the agent achieve?</span><input name="goal" className="input" maxLength={500} placeholder="Tell past guests about the December rate and book a room" /></label>
                <label className="field"><span>Contacts: one per line, &quot;name, number&quot; or just the number</span><textarea name="contacts" className="input" rows={6} required placeholder={"Chioma, 0803 123 4567\nTunde, +2348091234567"} /></label>
                <label className="field"><span>Stop after this many call minutes in total</span><input name="max_minutes" type="number" min={1} max={10000} defaultValue={30} className="input" /></label>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="confirm" value="yes" required /> These people agreed to hear from us. Anyone who asks won&apos;t be called again.</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-lime" name="start" value="now">Create and start</button>
                  <button className="btn btn-line" name="start" value="later">Save as draft</button>
                </div>
              </form>
            )}
          </section>
          <section className="panel">
            <h2>Campaigns</h2>
            {!(campaigns ?? []).length && <p className="muted">No campaigns yet.</p>}
            <ul className="ci-list">{(campaigns ?? []).map((c) => {
              const n = counts.get(c.id) ?? {};
              return (
                <li key={c.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                  <b>{c.name}</b>
                  <small className="muted">{({ draft: "Draft", running: "Running", paused: "Paused", done: "Finished" } as Record<string, string>)[c.status] ?? c.status} · {Number(c.minutes_used).toFixed(1)}/{c.max_minutes} min · {n.completed ?? 0} completed, {(n.queued ?? 0) + (n.dialing ?? 0) + (n.in_progress ?? 0)} to go{n.no_answer ? `, ${n.no_answer} no answer` : ""}</small>
                  {c.status !== "done" && <form action={setCampaign}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="to" value={c.status === "running" ? "paused" : "running"} /><button className="btn btn-line btn-sm">{c.status === "running" ? "Pause" : "Start"}</button></form>}
                </li>
              );
            })}</ul>
          </section>
        </>
      )}
    </>
  );
}
