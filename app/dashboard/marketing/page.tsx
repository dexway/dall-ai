import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireWorkspace, canManage } from "@/lib/workspace";
import { supabaseAdmin } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";
import { formatNaira } from "@/lib/money";
import { describePromo, promoUnavailable, type Promo } from "@/lib/promo";
import { audienceFor, marketingInsights, marketingSettings, generateCopy, sendBroadcast, type CopyPack } from "@/lib/marketing";
import { connectionFor } from "@/lib/channels/process";
import { listTemplates } from "@/lib/channels/send";
import { GatewayError } from "@/lib/ai/gateway";

export const metadata = { title: "Marketing" };

const CH: Record<string, string> = { whatsapp: "WhatsApp", facebook: "Messenger", instagram: "Instagram" };
const back = (q: string) => redirect(`/dashboard/marketing?${q}`);

async function manager() {
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) back("error=role");
  return ctx;
}

async function savePromo(formData: FormData) {
  "use server";
  const ctx = await manager();
  const code = String(formData.get("code") ?? "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20);
  const title = String(formData.get("title") ?? "").trim().slice(0, 80);
  const kind = formData.get("kind") === "fixed" ? "fixed" : "percent";
  const raw = Number(formData.get("value") ?? 0);
  const value = kind === "percent" ? Math.round(raw) : Math.round(raw * 100);
  const min = Math.round(Number(formData.get("min_order") || 0) * 100);
  const maxUses = Number(formData.get("max_uses") || 0) || null;
  const ends = String(formData.get("ends_at") ?? "");
  const items = formData.getAll("item_ids").map(String).filter(Boolean);
  if (code.length < 3 || !title || !(value > 0) || (kind === "percent" && value > 90)) back("error=promo");
  const { error } = await supabaseAdmin().from("promotions").insert({
    workspace_id: ctx.workspace.id, code, title, kind, value, min_order_kobo: min, max_uses: maxUses,
    ends_at: ends ? new Date(`${ends}T23:59:00+01:00`).toISOString() : null, item_ids: items.length ? items : null,
  });
  if (error) back(error.code === "23505" ? "error=promo_dup" : "error=save");
  revalidatePath("/dashboard/marketing");
  back("saved=promo");
}

async function togglePromo(formData: FormData) {
  "use server";
  const ctx = await manager();
  await supabaseAdmin().from("promotions").update({ active: formData.get("to") === "on" }).eq("id", String(formData.get("id"))).eq("workspace_id", ctx.workspace.id);
  revalidatePath("/dashboard/marketing");
  back("saved=1");
}

async function saveFollowups(formData: FormData) {
  "use server";
  const ctx = await manager();
  const clamp = (v: unknown, lo: number, hi: number, d: number) => Math.min(hi, Math.max(lo, Math.round(Number(v) || d)));
  await supabaseAdmin().from("marketing_settings").upsert({
    workspace_id: ctx.workspace.id, followups_enabled: formData.get("followups_enabled") === "on", upsell_enabled: formData.get("upsell_enabled") === "on",
    unpaid_nudge_minutes: clamp(formData.get("unpaid_nudge_minutes"), 5, 600, 20), quiet_lead_hours: clamp(formData.get("quiet_lead_hours"), 1, 23, 20),
    updated_at: new Date().toISOString(),
  });
  revalidatePath("/dashboard/marketing");
  back("saved=followups");
}

async function startBroadcast(formData: FormData) {
  "use server";
  const ctx = await manager();
  const channel = String(formData.get("channel") ?? "");
  if (!CH[channel]) back("error=broadcast");
  if (formData.get("confirm") !== "yes") back("error=confirm");
  const title = String(formData.get("title") ?? "").trim().slice(0, 80) || "Broadcast";
  const [tName, tLang] = String(formData.get("template") ?? "").split("|");
  const message = String(formData.get("message") ?? "").trim().slice(0, 1000);
  if (channel === "whatsapp" ? !tName || !tLang : message.length < 5) back("error=broadcast");
  const { eligible } = await audienceFor(ctx.workspace.id, channel);
  if (!eligible.length) back("error=audience");
  const { data: b, error } = await supabaseAdmin().from("broadcasts").insert({
    workspace_id: ctx.workspace.id, title, channel, message: channel === "whatsapp" ? null : message,
    template_name: tName || null, template_language: tLang || null, status: "sending", total: eligible.length, created_by: ctx.user.id,
  }).select("id").single();
  if (error || !b) back("error=save");
  await supabaseAdmin().from("financial_audit_logs").insert({ workspace_id: ctx.workspace.id, actor_id: ctx.user.id, action: "marketing.broadcast_started", entity: "broadcast", entity_id: b!.id, details: { channel, recipients: eligible.length } });
  after(() => sendBroadcast(b!.id));
  revalidatePath("/dashboard/marketing");
  back("saved=broadcast");
}

async function writeCopy(formData: FormData) {
  "use server";
  const ctx = await manager();
  const itemId = String(formData.get("item_id") ?? "");
  const goal = String(formData.get("goal") ?? "get more orders this week").slice(0, 200);
  const promoCode = String(formData.get("promo") ?? "");
  const db = supabaseAdmin();
  const { data: item } = itemId ? await db.from("catalogue_items").select("name,price_kobo,intro_price_kobo,description").eq("id", itemId).eq("workspace_id", ctx.workspace.id).maybeSingle() : { data: null };
  const { data: promo } = promoCode ? await db.from("promotions").select("*").eq("workspace_id", ctx.workspace.id).eq("code", promoCode).maybeSingle() : { data: null };
  let pack: CopyPack;
  try {
    pack = await generateCopy({ workspaceId: ctx.workspace.id, userId: ctx.user.id, businessName: ctx.workspace.name, goal,
      item: item ? { name: item.name, price: item.intro_price_kobo ?? item.price_kobo, description: item.description } : null,
      promo: promo ? describePromo(promo as Promo) : null });
  } catch (e) {
    back(`error=copy&why=${encodeURIComponent(e instanceof GatewayError ? e.message : "The AI couldn't write copy just now.")}`);
    return;
  }
  back(`copy=${encodeURIComponent(Buffer.from(JSON.stringify(pack)).toString("base64url"))}`);
}

export default async function MarketingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireWorkspace();
  const sp = await searchParams;
  const db = supabaseAdmin();
  const ws = ctx.workspace.id;
  const { error: setupErr } = await db.from("promotions").select("id").limit(1);
  if (setupErr) return (
    <>
      <div className="page-head"><div><h1>Marketing</h1><p>Promotions, follow-ups, broadcasts and AI copy.</p></div></div>
      <div className="panel"><h2>Almost ready</h2><p>Marketing is built and waiting for a one-time database setup. Once it's approved, promotions, follow-ups and broadcasts appear here.</p><a className="btn btn-line" href="/dashboard/studio">Preview the Content Creator →</a></div>
    </>
  );
  const [{ data: promos }, settings, insights, { data: items }, { data: followups }, { data: broadcasts }] = await Promise.all([
    db.from("promotions").select("*").eq("workspace_id", ws).order("created_at", { ascending: false }),
    marketingSettings(ws),
    marketingInsights(ws),
    db.from("catalogue_items").select("id,name").eq("workspace_id", ws).eq("active", true).order("name"),
    db.from("followups").select("kind,status,reason,message,created_at").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(15),
    db.from("broadcasts").select("id,title,channel,status,total,sent,failed,skipped,created_at").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(10),
  ]);
  const channel = CH[sp.bc ?? ""] ? sp.bc! : "whatsapp";
  const audience = await audienceFor(ws, channel);
  let templates: { name: string; language: string; body: string }[] = [];
  let templateNote = "";
  if (channel === "whatsapp") {
    const conn = await connectionFor(ws, "whatsapp");
    if (!conn) templateNote = "Connect WhatsApp on Channels first.";
    else if (!conn.waba_id) templateNote = "Reconnect WhatsApp so Dall AI can load your approved templates.";
    else { try { templates = await listTemplates(decryptSecret(conn.access_token_enc), conn.waba_id); } catch (e) { templateNote = `Couldn't load templates: ${(e as Error).message.slice(0, 120)}`; } }
  }
  let copy: CopyPack | null = null;
  try { copy = sp.copy ? JSON.parse(Buffer.from(sp.copy, "base64url").toString()) as CopyPack : null; } catch { copy = null; }
  const livePromos = ((promos ?? []) as Promo[]).filter((p) => !promoUnavailable(p));

  const errors: Record<string, string> = { role: "Only owners and admins can change marketing.", promo: "Give the promotion a code (3+ letters), a title and a value (percent up to 90).", promo_dup: "That code already exists.", save: "Couldn't save. Try again.", broadcast: "Pick a template (WhatsApp) or write a message of at least 5 characters.", confirm: "Tick the box to confirm sending.", audience: "Nobody on this channel can receive a broadcast yet.", copy: "Couldn't write copy" };
  const saved: Record<string, string> = { promo: "Promotion saved. Your assistant can offer it from the next message.", followups: "Follow-up settings saved.", broadcast: "Broadcast is sending. Results update below as messages go out.", "1": "Saved." };

  return (
    <>
      <div className="page-head"><div><h1>Marketing</h1><p>Promotions your assistant can sell, follow-ups that win back sales, broadcasts to customers who said yes, and copy written from your real catalogue.</p></div>
        <Link className="btn btn-line" href="/dashboard/studio">Content Creator →</Link></div>
      {sp.error && <div className="notice notice-bad" role="alert">{errors[sp.error] ?? "Something went wrong."}{sp.why ? `: ${sp.why}` : ""}</div>}
      {sp.saved && <div className="notice notice-ok" role="status">{saved[sp.saved] ?? "Saved."}</div>}

      <div className="stats">
        <div className="stat"><span>Unpaid checkouts (30 days)</span><b>{insights.unpaidCount}</b><small>{formatNaira(insights.unpaidValue)} waiting</small></div>
        <div className="stat"><span>Live promotions</span><b>{livePromos.length}</b></div>
        {Object.entries(CH).map(([k, v]) => <div key={k} className="stat"><span>{v} opted in</span><b>{insights.audience[k] ?? 0}</b></div>)}
      </div>

      <section className="panel">
        <h2>Copilot: what to promote</h2>
        <div className="two">
          <div>
            <h3 style={{ fontSize: 14 }}>Best sellers (30 days)</h3>
            {insights.topSellers.length ? <ul>{insights.topSellers.map((r) => <li key={r.id}>{r.name}: {r.unitsSold} sold · {formatNaira(r.revenue)}</li>)}</ul> : <p className="muted">No paid orders yet.</p>}
            <h3 style={{ fontSize: 14 }}>Asked about, not bought</h3>
            {insights.askedNotBought.length ? <ul>{insights.askedNotBought.map((r) => <li key={r.id}>{r.name}: mentioned in {r.mentions} chats, 0 sales. Worth a promotion or a clearer photo/price.</li>)}</ul> : <p className="muted">Nothing stands out yet.</p>}
          </div>
          <form action={writeCopy} style={{ display: "grid", gap: 8 }}>
            <label className="field"><span>Product</span><select name="item_id" className="input"><option value="">The whole business</option>{(items ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
            <label className="field"><span>Goal</span><input name="goal" className="input" defaultValue="get more orders this week" /></label>
            <label className="field"><span>Mention a promotion</span><select name="promo" className="input"><option value="">None</option>{livePromos.map((p) => <option key={p.id} value={p.code}>{p.code}</option>)}</select></label>
            <button className="btn btn-ink">✍️ Write ad, post and broadcast copy</button>
          </form>
        </div>
        {copy && (
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {([["Ad headline", copy.headline], ["Ad text", copy.ad_text], ["Instagram caption", copy.instagram_caption], ["WhatsApp status", copy.whatsapp_status], ["Broadcast message", copy.broadcast_message]] as const).map(([l, t]) => (
              <div key={l} style={{ border: "1px solid var(--line,#e7e7e3)", borderRadius: 10, padding: 10 }}><small className="muted">{l}</small><div style={{ whiteSpace: "pre-wrap" }}>{t}</div></div>
            ))}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link className="btn btn-lime btn-sm" href={`/dashboard/ads?prefill=${encodeURIComponent(copy.ad_text)}&headline=${encodeURIComponent(copy.headline)}`}>Use in an ad →</Link>
              <Link className="btn btn-line btn-sm" href={`/dashboard/marketing?bc=facebook&msg=${encodeURIComponent(copy.broadcast_message)}#broadcast`}>Use in a broadcast →</Link>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Promotions</h2>
        <p className="muted" style={{ fontSize: 14 }}>Your assistant checks these before every total, mentions one that fits, and applies the code at checkout. The server checks dates, limits and minimums, so the AI can never give more than you set.</p>
        {(promos ?? []).length > 0 && (
          <div className="table-wrap"><table>
            <thead><tr><th>Code</th><th>Offer</th><th className="num">Used</th><th>Status</th><th></th></tr></thead>
            <tbody>{((promos ?? []) as Promo[]).map((p) => { const why = promoUnavailable(p); return (
              <tr key={p.id}><td className="mono">{p.code}</td><td>{describePromo(p)}</td><td className="num">{p.uses}{p.max_uses ? ` / ${p.max_uses}` : ""}</td>
                <td>{why ? <small>{why}</small> : <span style={{ color: "#1E7A45", fontWeight: 600 }}>Live</span>}</td>
                <td><form action={togglePromo}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="to" value={p.active ? "off" : "on"} /><button className="btn btn-line btn-sm">{p.active ? "Stop" : "Restart"}</button></form></td></tr>
            ); })}</tbody>
          </table></div>
        )}
        <form action={savePromo} style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", marginTop: 10 }}>
          <label className="field"><span>Code</span><input name="code" className="input mono" placeholder="JOLLOF10" required /></label>
          <label className="field"><span>Title</span><input name="title" className="input" placeholder="Weekend party deal" required /></label>
          <label className="field"><span>Type</span><select name="kind" className="input"><option value="percent">% off</option><option value="fixed">₦ off</option></select></label>
          <label className="field"><span>Value</span><input name="value" type="number" min={1} step="any" className="input" required /></label>
          <label className="field"><span>Min order (₦)</span><input name="min_order" type="number" min={0} className="input" /></label>
          <label className="field"><span>Max uses</span><input name="max_uses" type="number" min={1} className="input" placeholder="Unlimited" /></label>
          <label className="field"><span>Ends</span><input name="ends_at" type="date" className="input" /></label>
          <label className="field"><span>Only these items</span><select name="item_ids" multiple className="input" style={{ minHeight: 70 }}>{(items ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
          <div style={{ alignSelf: "end" }}><button className="btn btn-ink">Add promotion</button></div>
        </form>
      </section>

      <section className="panel">
        <h2>Follow-ups</h2>
        <form action={saveFollowups} style={{ display: "grid", gap: 8, maxWidth: 560 }}>
          <label style={{ display: "flex", gap: 8 }}><input type="checkbox" name="followups_enabled" defaultChecked={settings.followups_enabled} /> Send automatic follow-ups on WhatsApp, Messenger and Instagram</label>
          <label className="field"><span>Remind unpaid checkouts after (minutes)</span><input name="unpaid_nudge_minutes" type="number" min={5} max={600} defaultValue={settings.unpaid_nudge_minutes} className="input" /></label>
          <label className="field"><span>Nudge quiet chats after (hours, max 23 to stay inside Meta&apos;s 24-hour window)</span><input name="quiet_lead_hours" type="number" min={1} max={23} defaultValue={settings.quiet_lead_hours} className="input" /></label>
          <label style={{ display: "flex", gap: 8 }}><input type="checkbox" name="upsell_enabled" defaultChecked={settings.upsell_enabled} /> Let the assistant suggest one add-on after the customer chooses</label>
          <div><button className="btn btn-line btn-sm">Save</button></div>
        </form>
        <p className="muted" style={{ fontSize: 13 }}>One reminder per unpaid order, one nudge per quiet chat a week, never after a team takeover or a STOP. Runs every 5 minutes.</p>
        {(followups ?? []).length > 0 && <div className="table-wrap"><table><thead><tr><th>When</th><th>Type</th><th>Result</th><th>Message</th></tr></thead><tbody>
          {(followups ?? []).map((f, i) => <tr key={i}><td>{new Date(f.created_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</td><td>{f.kind === "unpaid_checkout" ? "Unpaid checkout" : "Quiet chat"}</td><td>{f.status}{f.reason ? <><br /><small>{f.reason}</small></> : null}</td><td><small>{f.message}</small></td></tr>)}
        </tbody></table></div>}
      </section>

      <section className="panel" id="broadcast">
        <h2>Broadcasts</h2>
        <p className="muted" style={{ fontSize: 14 }}>Only customers who said yes to offers, and haven&apos;t replied STOP. WhatsApp uses your approved templates (any time). Messenger and Instagram allow free text only within 24 hours of the customer&apos;s last message, so others are left out.</p>
        <div className="inbox-filters">{Object.entries(CH).map(([k, v]) => <Link key={k} href={`/dashboard/marketing?bc=${k}#broadcast`} className={`pill ${channel === k ? "on" : ""}`}>{v}</Link>)}</div>
        <p style={{ fontSize: 14 }}><b>{audience.eligible.length}</b> can receive it now{audience.outsideWindow ? ` · ${audience.outsideWindow} opted in but outside the 24-hour window` : ""} · {audience.noConsent} haven&apos;t opted in</p>
        <form action={startBroadcast} style={{ display: "grid", gap: 8, maxWidth: 620 }}>
          <input type="hidden" name="channel" value={channel} />
          <label className="field"><span>Name (for you)</span><input name="title" className="input" placeholder="Weekend promo" /></label>
          {channel === "whatsapp" ? (templateNote ? <p className="muted">{templateNote}</p> :
            <label className="field"><span>Approved template</span><select name="template" className="input">{templates.map((t) => <option key={t.name + t.language} value={`${t.name}|${t.language}`}>{t.name} ({t.language}): {t.body.slice(0, 70)}</option>)}</select></label>)
            : <label className="field"><span>Message</span><textarea name="message" rows={4} maxLength={1000} className="input" defaultValue={sp.msg ?? ""} /></label>}
          <label style={{ display: "flex", gap: 8, fontSize: 13 }}><input type="checkbox" name="confirm" value="yes" required /> Send to {audience.eligible.length} customer(s) now</label>
          <div><button className="btn btn-lime" disabled={!audience.eligible.length}>Send broadcast</button></div>
        </form>
        {(broadcasts ?? []).length > 0 && <div className="table-wrap" style={{ marginTop: 10 }}><table><thead><tr><th>Broadcast</th><th>Channel</th><th>Status</th><th className="num">Sent</th><th className="num">Failed</th><th className="num">Skipped</th></tr></thead><tbody>
          {(broadcasts ?? []).map((b) => <tr key={b.id}><td>{b.title}<br /><small>{new Date(b.created_at).toLocaleDateString("en-NG")}</small></td><td>{CH[b.channel]}</td><td>{b.status}</td><td className="num">{b.sent} / {b.total}</td><td className="num">{b.failed}</td><td className="num">{b.skipped}</td></tr>)}
        </tbody></table></div>}
      </section>
    </>
  );
}
