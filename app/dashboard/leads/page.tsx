import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/workspace";
import { supabaseAdmin } from "@/lib/supabase/server";
import { adFunnel } from "@/lib/funnel";

export const metadata = { title: "Leads" };

const STATUS = ["new", "qualified", "sales_ready", "won", "lost"] as const;
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", facebook: "Messenger", instagram: "Instagram", web: "Website" };

async function setStatus(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!(STATUS as readonly string[]).includes(status)) redirect("/dashboard/leads");
  await supabaseAdmin().from("leads").update({ status, updated_at: new Date().toISOString() }).eq("id", id).eq("workspace_id", ctx.workspace.id);
  revalidatePath("/dashboard/leads");
  redirect(`/dashboard/leads?${new URLSearchParams({ s: String(formData.get("s") ?? "") }).toString()}`);
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireWorkspace();
  const sp = await searchParams;
  let q = ctx.db.from("leads").select("id,name,phone,email,interest,budget,status,consent_contact,channel,ad_id,conversation_id,created_by,created_at")
    .eq("workspace_id", ctx.workspace.id).order("created_at", { ascending: false }).limit(200);
  if (sp.s && (STATUS as readonly string[]).includes(sp.s)) q = q.eq("status", sp.s);
  const [{ data: leads }, funnel] = await Promise.all([q, adFunnel(ctx.workspace.id)]);
  const counts = Object.fromEntries(STATUS.map((s) => [s, 0])) as Record<string, number>;
  const { data: all } = await ctx.db.from("leads").select("status").eq("workspace_id", ctx.workspace.id);
  for (const l of all ?? []) counts[l.status] = (counts[l.status] ?? 0) + 1;

  return (
    <>
      <div className="page-head">
        <div><h1>Leads</h1><p>People your assistant (or your team) qualified in chat. Sales-ready leads are waiting for a person.</p></div>
        <Link className="btn btn-line" href="/dashboard/inbox">Inbox →</Link>
      </div>

      <div className="stats">
        {STATUS.map((s) => (
          <Link key={s} href={`/dashboard/leads?s=${s}`} className={`stat${s === "sales_ready" && counts[s] ? " attn" : ""}`} style={{ textDecoration: "none", color: "inherit" }}>
            <span>{s.replace("_", " ")}</span><b>{counts[s]}</b>
          </Link>
        ))}
      </div>

      <div className="panel">
        <div className="page-head"><h2>{sp.s ? `${sp.s.replace("_", " ")} leads` : "All leads"}</h2>{sp.s && <Link href="/dashboard/leads">Show all</Link>}</div>
        {!leads?.length ? <div className="empty">No leads yet. Your assistant saves one when a customer says what they want, and asks before keeping their contact details.</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Who</th><th>Wants</th><th>Channel</th><th>Source</th><th>Consent</th><th>Status</th><th></th></tr></thead>
            <tbody>{leads.map((l) => (
              <tr key={l.id}>
                <td><b>{l.name ?? "—"}</b><br /><small className="mono">{[l.phone, l.email].filter(Boolean).join(" · ")}</small></td>
                <td>{l.interest ?? "—"}{l.budget ? <><br /><small>Budget: {l.budget}</small></> : null}</td>
                <td>{CHANNEL[l.channel ?? ""] ?? "—"}</td>
                <td>{l.ad_id ? <span className="mono" title="Meta reported this chat started from an ad">Ad {l.ad_id}</span> : <small>Not reported</small>}</td>
                <td>{l.consent_contact ? "✓ Agreed" : <small>Not asked / no</small>}</td>
                <td>
                  <form action={setStatus} style={{ display: "flex", gap: 6 }}>
                    <input type="hidden" name="id" value={l.id} /><input type="hidden" name="s" value={sp.s ?? ""} />
                    <select name="status" defaultValue={l.status} className="input" style={{ padding: "4px 6px" }}>{STATUS.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
                    <button className="btn btn-line btn-sm">Save</button>
                  </form>
                </td>
                <td>{l.conversation_id && <Link href={`/dashboard/inbox?c=${l.conversation_id}`}>Chat →</Link>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="panel">
        <h2>Ads → chats → leads → sales</h2>
        <p style={{ color: "var(--ink-70)", fontSize: 14, marginTop: 0 }}>Counts a chat as coming from an ad only when Meta sent the ad ID with the message. Chats without it are shown as “not reported”, never guessed.</p>
        {!funnel.rows.length ? <div className="empty">No campaigns launched from Dall AI yet.</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Campaign</th><th className="num">Spend</th><th className="num">Chats (Meta)</th><th className="num">Chats we received</th><th className="num">Leads</th><th className="num">Paid orders</th></tr></thead>
            <tbody>{funnel.rows.map((r) => (
              <tr key={r.id}><td>{r.name}</td><td className="num">{r.spend}</td><td className="num">{r.metaConversations ?? "—"}</td><td className="num">{r.conversations}</td><td className="num">{r.leads}</td><td className="num">{r.paidOrders}</td></tr>
            ))}</tbody>
          </table></div>
        )}
        <p style={{ fontSize: 13, color: "var(--ink-70)" }}>Chats not linked to any ad in the last 30 days: <b>{funnel.unattributed}</b>.</p>
      </div>
    </>
  );
}
