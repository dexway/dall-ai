import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/workspace";
import { supabaseAdmin } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";
import { replyWindow, type Provider } from "@/lib/channels/events";
import { deliver, connectionFor, logIntegrationError } from "@/lib/channels/process";
import { sendTemplate, listTemplates } from "@/lib/channels/send";

export const metadata = { title: "Inbox" };

const CH: Record<string, { label: string; color: string; letter: string }> = {
  whatsapp: { label: "WhatsApp", color: "#25D366", letter: "W" },
  facebook: { label: "Messenger", color: "#1877F2", letter: "M" },
  instagram: { label: "Instagram", color: "#D62976", letter: "I" },
  web: { label: "Website chat", color: "#7FA34A", letter: "◎" },
};
const OUTCOMES = ["open", "qualified", "won", "lost", "spam"] as const;
const LEAD_STATUS = ["new", "qualified", "sales_ready", "won", "lost"] as const;

type Sp = Record<string, string | undefined>;
const go = (sp: { c?: string; f?: string; ch?: string }, extra = "") => {
  const q = new URLSearchParams();
  if (sp.c) q.set("c", sp.c); if (sp.f) q.set("f", sp.f); if (sp.ch) q.set("ch", sp.ch);
  return `/dashboard/inbox?${q.toString()}${extra ? `&${extra}` : ""}`;
};

/** Loads a conversation only if it belongs to the signed-in user's business. */
async function ownConversation(id: string) {
  const ctx = await requireWorkspace();
  const { data: conv } = await supabaseAdmin().from("conversations")
    .select("id,workspace_id,channel,external_ref,last_inbound_at,ai_paused,ad_id").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!conv) redirect("/dashboard/inbox?error=notfound");
  return { ctx, conv };
}

async function toggleAi(formData: FormData) {
  "use server";
  const id = String(formData.get("c") ?? "");
  const { ctx, conv } = await ownConversation(id);
  const pause = formData.get("to") === "pause";
  await supabaseAdmin().from("conversations").update({ ai_paused: pause, ...(pause ? { handoff_reason: "Taken over by the team", assigned_to: ctx.user.id } : { handoff_reason: null }) }).eq("id", conv.id);
  await supabaseAdmin().from("financial_audit_logs").insert({ workspace_id: ctx.workspace.id, actor_id: ctx.user.id, action: pause ? "inbox.ai_paused" : "inbox.ai_resumed", entity: "conversation", entity_id: conv.id, details: {} });
  revalidatePath("/dashboard/inbox");
  redirect(go({ c: conv.id, f: String(formData.get("f") ?? "") || undefined, ch: String(formData.get("ch") ?? "") || undefined }));
}

async function updateConversation(formData: FormData) {
  "use server";
  const { conv } = await ownConversation(String(formData.get("c") ?? ""));
  const outcome = String(formData.get("outcome") ?? "");
  const assigned = String(formData.get("assigned_to") ?? "");
  const patch: Record<string, unknown> = {};
  if ((OUTCOMES as readonly string[]).includes(outcome)) patch.outcome = outcome;
  if (formData.has("assigned_to")) patch.assigned_to = assigned || null;
  if (Object.keys(patch).length) await supabaseAdmin().from("conversations").update(patch).eq("id", conv.id);
  revalidatePath("/dashboard/inbox");
  redirect(go({ c: conv.id }, "saved=1"));
}

async function sendReply(formData: FormData) {
  "use server";
  const { ctx, conv } = await ownConversation(String(formData.get("c") ?? ""));
  const text = String(formData.get("text") ?? "").trim().slice(0, 2000);
  if (!text) redirect(go({ c: conv.id }, "error=empty"));
  const db = supabaseAdmin();
  if (conv.channel === "web") {
    // Website chat: the visitor's widget picks this up within 15 seconds.
    await db.from("messages").insert({ conversation_id: conv.id, workspace_id: conv.workspace_id, role: "human", content: { text }, sent_by: ctx.user.id, delivery_status: "sent" });
    await db.from("conversations").update({ last_message_at: new Date().toISOString(), unread: false, ai_paused: true, assigned_to: ctx.user.id }).eq("id", conv.id);
    revalidatePath("/dashboard/inbox");
    redirect(go({ c: conv.id }, "sent=1"));
  }
  const conn = await connectionFor(conv.workspace_id, conv.channel);
  if (!conn) redirect(go({ c: conv.id }, "error=noconn"));
  // A person replying takes the chat over so the assistant doesn't talk over them.
  await db.from("conversations").update({ ai_paused: true, assigned_to: ctx.user.id }).eq("id", conv.id);
  const r = await deliver({ conn: conn!, conv, text, role: "human", sentBy: ctx.user.id });
  revalidatePath("/dashboard/inbox");
  redirect(go({ c: conv.id }, r.ok ? "sent=1" : `error=send&why=${encodeURIComponent(r.error.slice(0, 200))}`));
}

async function sendTemplateAction(formData: FormData) {
  "use server";
  const { ctx, conv } = await ownConversation(String(formData.get("c") ?? ""));
  const [name, language] = String(formData.get("template") ?? "").split("|");
  if (conv.channel !== "whatsapp" || !name || !language) redirect(go({ c: conv.id }, "error=template"));
  const conn = await connectionFor(conv.workspace_id, "whatsapp");
  if (!conn) redirect(go({ c: conv.id }, "error=noconn"));
  const db = supabaseAdmin();
  const base = { conversation_id: conv.id, workspace_id: conv.workspace_id, role: "human", content: { text: `[Template: ${name}]` }, sent_by: ctx.user.id };
  try {
    const { providerMessageId } = await sendTemplate({ token: decryptSecret(conn!.access_token_enc), phoneNumberId: conn!.external_id, to: conv.external_ref!, name, language });
    await db.from("messages").insert({ ...base, delivery_status: "sent", provider_message_id: providerMessageId });
    await db.from("conversations").update({ last_message_at: new Date().toISOString(), ai_paused: true, assigned_to: ctx.user.id }).eq("id", conv.id);
    revalidatePath("/dashboard/inbox");
    redirect(go({ c: conv.id }, "sent=1"));
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    const msg = (e as Error).message;
    await db.from("messages").insert({ ...base, delivery_status: "failed", delivery_error: msg.slice(0, 300) });
    await logIntegrationError(conv.workspace_id, "whatsapp_send", msg, { conversation_id: conv.id, template: name });
    redirect(go({ c: conv.id }, `error=send&why=${encodeURIComponent(msg.slice(0, 200))}`));
  }
}

async function saveLead(formData: FormData) {
  "use server";
  const { conv } = await ownConversation(String(formData.get("c") ?? ""));
  const s = (k: string, n = 200) => { const v = String(formData.get(k) ?? "").trim(); return v ? v.slice(0, n) : null; };
  const status = String(formData.get("status") ?? "new");
  await supabaseAdmin().from("leads").upsert({
    workspace_id: conv.workspace_id, conversation_id: conv.id, channel: conv.channel, ad_id: conv.ad_id,
    name: s("name", 120), phone: s("phone", 40), email: s("email", 160), interest: s("interest", 300), notes: s("notes", 500),
    status: (LEAD_STATUS as readonly string[]).includes(status) ? status : "new",
    consent_contact: formData.get("consent_contact") === "on", created_by: "human", updated_at: new Date().toISOString(),
  }, { onConflict: "conversation_id" });
  revalidatePath("/dashboard/inbox");
  redirect(go({ c: conv.id }, "saved=lead"));
}

function when(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso), now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-NG", { day: "numeric", month: "short" });
}
const ticks: Record<string, string> = { pending: "…", sent: "✓", delivered: "✓✓", read: "✓✓ read", failed: "✗ not delivered" };

export default async function InboxPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const ctx = await requireWorkspace();
  const sp = await searchParams;
  const db = supabaseAdmin();
  const ws = ctx.workspace.id;

  let q = db.from("conversations").select("id,channel,external_ref,contact_name,last_message_at,unread,ai_paused,handoff_reason,outcome,assigned_to,ad_id,attribution,created_at")
    .eq("workspace_id", ws).order("last_message_at", { ascending: false, nullsFirst: false }).limit(60);
  if (sp.ch && CH[sp.ch]) q = q.eq("channel", sp.ch);
  if (sp.f === "unread") q = q.eq("unread", true);
  if (sp.f === "human") q = q.eq("ai_paused", true);
  if (sp.f === "mine") q = q.eq("assigned_to", ctx.user.id);
  if (sp.f === "ads") q = q.not("ad_id", "is", null);
  const { data: convs } = await q;
  const ids = (convs ?? []).map((c) => c.id);
  const { data: lastMsgs } = ids.length
    ? await db.from("messages").select("conversation_id,role,content,created_at").in("conversation_id", ids).order("created_at", { ascending: false }).limit(400)
    : { data: [] as { conversation_id: string; role: string; content: { text?: string }; created_at: string }[] };
  const preview = new Map<string, string>();
  for (const m of lastMsgs ?? []) if (!preview.has(m.conversation_id)) preview.set(m.conversation_id, `${m.role === "user" ? "" : m.role === "human" ? "You: " : "AI: "}${(m.content as { text?: string }).text ?? "📎"}`);

  const selectedId = sp.c ?? convs?.[0]?.id;
  const sel = selectedId ? (await db.from("conversations").select("*").eq("id", selectedId).eq("workspace_id", ws).maybeSingle()).data : null;
  if (sel?.unread) await db.from("conversations").update({ unread: false }).eq("id", sel.id);

  const [{ data: thread }, { data: lead }, { data: members }, { data: orders }] = sel ? await Promise.all([
    db.from("messages").select("id,role,content,created_at,delivery_status,delivery_error,attachments,sent_by").eq("conversation_id", sel.id).order("created_at").limit(200),
    db.from("leads").select("*").eq("conversation_id", sel.id).maybeSingle(),
    db.from("workspace_members").select("user_id,role").eq("workspace_id", ws),
    db.from("orders").select("reference,status,total_kobo").eq("conversation_id", sel.id).order("created_at", { ascending: false }).limit(5),
  ]) : [{ data: null }, { data: null }, { data: null }, { data: null }];
  const { data: profiles } = members?.length ? await db.from("profiles").select("id,full_name").in("id", members.map((m) => m.user_id)) : { data: [] as { id: string; full_name: string | null }[] };
  const nameOf = (id: string | null) => (id === ctx.user.id ? "You" : profiles?.find((p) => p.id === id)?.full_name) ?? "Team member";

  const win = sel ? replyWindow(sel.channel as Provider | "web", sel.last_inbound_at, "human") : null;
  const conn = sel && sel.channel !== "web" ? await connectionFor(ws, sel.channel) : null;
  let templates: { name: string; language: string; body: string }[] = [];
  let templateErr = "";
  if (sel?.channel === "whatsapp" && win && !win.ok && conn?.waba_id) {
    try { templates = await listTemplates(decryptSecret(conn.access_token_enc), conn.waba_id); }
    catch (e) { templateErr = (e as Error).message.slice(0, 160); }
  }
  const attr = sel?.attribution as { source?: string; ad_id?: string; headline?: string; ref?: string; ctwa_clid?: string } | null;
  const chipFor = (ch: string) => CH[ch] ?? { label: ch, color: "#888", letter: "?" };
  const errorText: Record<string, string> = { empty: "Type a message first.", noconn: "This channel isn't connected any more. Reconnect it on Channels.", send: "Meta didn't accept the message", template: "Pick a template to send.", notfound: "That conversation doesn't exist." };

  return (
    <>
      <div className="page-head">
        <div><h1>Inbox</h1><p>Every chat from WhatsApp, Messenger, Instagram and your website. Take over from the assistant any time.</p></div>
        <Link className="btn btn-line" href="/dashboard/leads">Leads →</Link>
      </div>
      {sp.error && <div className="notice notice-bad" role="alert">{errorText[sp.error] ?? "Something went wrong."}{sp.why ? `: ${sp.why}` : "."}</div>}
      {sp.sent && <div className="notice notice-ok" role="status">Sent. You&apos;ve taken over this chat, so the assistant is paused here until you resume it.</div>}
      {sp.saved && <div className="notice notice-ok" role="status">Saved.</div>}

      <div className="inbox">
        <aside className="inbox-list panel">
          <div className="inbox-filters">
            {[["", "All"], ["unread", "Needs reply"], ["human", "Team handling"], ["mine", "Mine"], ["ads", "From ads"]].map(([f, l]) => (
              <Link key={f} href={go({ f: f || undefined, ch: sp.ch })} className={`pill ${(sp.f ?? "") === f ? "on" : ""}`}>{l}</Link>
            ))}
          </div>
          <div className="inbox-filters">
            <Link href={go({ f: sp.f })} className={`pill ${!sp.ch ? "on" : ""}`}>All channels</Link>
            {Object.entries(CH).map(([k, v]) => <Link key={k} href={go({ f: sp.f, ch: k })} className={`pill ${sp.ch === k ? "on" : ""}`}>{v.label}</Link>)}
          </div>
          {!convs?.length && <div className="empty">No conversations yet. They appear here as soon as a customer messages any connected channel.</div>}
          <ul>
            {(convs ?? []).map((c) => {
              const ch = chipFor(c.channel);
              return (
                <li key={c.id}>
                  <Link href={go({ c: c.id, f: sp.f, ch: sp.ch })} className={`inbox-row ${c.id === sel?.id ? "on" : ""} ${c.unread ? "unread" : ""}`}>
                    <span className="ch" style={{ background: ch.color }} title={ch.label}>{ch.letter}</span>
                    <span className="who">
                      <b>{c.contact_name || (c.channel === "whatsapp" ? `+${c.external_ref}` : c.channel === "web" ? "Website visitor" : `Customer ${String(c.external_ref ?? "").slice(-5)}`)}</b>
                      <small>{preview.get(c.id) ?? "…"}</small>
                    </span>
                    <span className="meta">
                      <small>{when(c.last_message_at)}</small>
                      {c.ai_paused ? <em className="tag human">Team</em> : <em className="tag ai">AI</em>}
                      {c.ad_id && <em className="tag ad">Ad</em>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="inbox-thread panel">
          {!sel ? <div className="empty">Pick a conversation.</div> : (
            <>
              <header className="thread-head">
                <div>
                  <b>{sel.contact_name || (sel.channel === "whatsapp" ? `+${sel.external_ref}` : chipFor(sel.channel).label + " customer")}</b>
                  <small> · {chipFor(sel.channel).label}{sel.channel === "whatsapp" ? ` · +${sel.external_ref}` : ""}</small>
                  <div className="attr">
                    {attr?.source === "ad"
                      ? <>📣 Came from an ad{attr.headline ? `: “${attr.headline}”` : ""} <span className="mono">{attr.ad_id ? `· ad ${attr.ad_id}` : ""}</span></>
                      : attr?.source ? <>🔗 Came from {attr.source}{attr.ref ? ` (${attr.ref})` : ""}</>
                      : <>Source: not reported by Meta</>}
                  </div>
                </div>
                <form action={toggleAi}>
                  <input type="hidden" name="c" value={sel.id} /><input type="hidden" name="to" value={sel.ai_paused ? "resume" : "pause"} />
                  {sel.ai_paused
                    ? <button className="btn btn-lime btn-sm">▶ Resume assistant</button>
                    : <button className="btn btn-ink btn-sm">✋ Take over (pause AI)</button>}
                </form>
              </header>
              {sel.handoff_reason && <div className="handoff">{sel.ai_paused ? "🙋 Team handling" : "⚠️ Needs attention"}: {sel.handoff_reason}{sel.assigned_to ? ` · assigned to ${nameOf(sel.assigned_to)}` : ""}</div>}

              <div className="thread">
                {(thread ?? []).map((m) => {
                  const atts = (m.attachments as { type: string }[]) ?? [];
                  return (
                    <div key={m.id} className={`bubble ${m.role}`}>
                      <small className="by">{m.role === "user" ? "Customer" : m.role === "human" ? nameOf(m.sent_by) : "Assistant"} · {when(m.created_at)}</small>
                      {atts.length > 0 && <div className="att">📎 {atts.map((a) => a.type).join(", ")}</div>}
                      <div>{String((m.content as { text?: string }).text ?? "")}</div>
                      {m.role !== "user" && m.delivery_status && (
                        <small className={`dl ${m.delivery_status}`} title={m.delivery_error ?? ""}>{ticks[m.delivery_status]}{m.delivery_status === "failed" && m.delivery_error ? ` · ${m.delivery_error}` : ""}</small>
                      )}
                    </div>
                  );
                })}
              </div>

              {win && !win.ok && <div className="window">{win.reason}</div>}
              {win && win.ok && "tag" in win && win.tag && <div className="window ok">More than 24 hours since their last message: your reply goes out with Meta&apos;s Human Agent tag (allowed up to 7 days).</div>}
              {(!win || win.ok) ? (
                <form action={sendReply} className="reply">
                  <input type="hidden" name="c" value={sel.id} />
                  <label htmlFor="reply-text" className="sr">Reply</label>
                  <textarea id="reply-text" name="text" rows={2} maxLength={2000} className="input" placeholder={`Reply on ${chipFor(sel.channel).label}… (sending pauses the assistant in this chat)`} required />
                  <button className="btn btn-lime">Send</button>
                </form>
              ) : sel.channel === "whatsapp" ? (
                <form action={sendTemplateAction} className="reply">
                  <input type="hidden" name="c" value={sel.id} />
                  {!conn?.waba_id ? <p className="hint">Reconnect WhatsApp on Channels so Dall AI can load your approved templates.</p>
                    : templateErr ? <p className="hint">Couldn&apos;t load templates: {templateErr}</p>
                    : !templates.length ? <p className="hint">No approved templates yet. Create one in WhatsApp Manager → Message templates, then reload.</p>
                    : <>
                        <select name="template" className="input" required>
                          {templates.map((t) => <option key={t.name + t.language} value={`${t.name}|${t.language}`}>{t.name} ({t.language}) — {t.body.slice(0, 60)}</option>)}
                        </select>
                        <button className="btn btn-lime">Send template</button>
                      </>}
                </form>
              ) : null}
            </>
          )}
        </section>

        {sel && (
          <aside className="inbox-side">
            <form action={updateConversation} className="panel">
              <h3>Conversation</h3>
              <input type="hidden" name="c" value={sel.id} />
              <label className="field"><span>Outcome</span>
                <select name="outcome" defaultValue={sel.outcome} className="input">{OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
              <label className="field"><span>Assigned to</span>
                <select name="assigned_to" defaultValue={sel.assigned_to ?? ""} className="input">
                  <option value="">Nobody</option>
                  {(members ?? []).map((m) => <option key={m.user_id} value={m.user_id}>{nameOf(m.user_id)} ({m.role})</option>)}
                </select></label>
              <button className="btn btn-line btn-sm">Save</button>
              {(orders ?? []).length > 0 && <div style={{ marginTop: 10, fontSize: 13 }}><b>Orders</b>{(orders ?? []).map((o) => <div key={o.reference} className="mono">{o.reference} · {o.status.replace(/_/g, " ")}</div>)}</div>}
            </form>
            <form action={saveLead} className="panel" style={{ marginTop: 12 }}>
              <h3>Lead {lead ? <small style={{ fontWeight: 400 }}>· saved by {lead.created_by === "agent" ? "assistant" : "team"}</small> : ""}</h3>
              <input type="hidden" name="c" value={sel.id} />
              <label className="field"><span>Name</span><input name="name" className="input" defaultValue={lead?.name ?? sel.contact_name ?? ""} /></label>
              <label className="field"><span>Phone</span><input name="phone" className="input" defaultValue={lead?.phone ?? (sel.channel === "whatsapp" ? `+${sel.external_ref}` : "")} /></label>
              <label className="field"><span>Email</span><input name="email" type="email" className="input" defaultValue={lead?.email ?? ""} /></label>
              <label className="field"><span>Interested in</span><input name="interest" className="input" defaultValue={lead?.interest ?? ""} /></label>
              <label className="field"><span>Status</span><select name="status" className="input" defaultValue={lead?.status ?? "new"}>{LEAD_STATUS.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></label>
              <label className="field"><span>Notes</span><textarea name="notes" className="input" rows={2} defaultValue={lead?.notes ?? ""} /></label>
              <label style={{ display: "flex", gap: 8, fontSize: 13, margin: "6px 0" }}><input type="checkbox" name="consent_contact" defaultChecked={Boolean(lead?.consent_contact)} /> Customer agreed to be contacted</label>
              <button className="btn btn-line btn-sm">{lead ? "Update lead" : "Save as lead"}</button>
            </form>
          </aside>
        )}
      </div>
    </>
  );
}
