import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace, canManage } from "@/lib/workspace";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatNaira } from "@/lib/money";
import { StatusChip } from "@/lib/status";

export const metadata = { title: "Order" };

async function markFulfilled(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  const id = String(formData.get("id"));
  if (!canManage(ctx)) redirect(`/dashboard/orders/${id}`);
  // Read through RLS first (proves membership), then write with the server client.
  const { data: o } = await ctx.db.from("orders").select("id,reference,status").eq("id", id).eq("workspace_id", ctx.workspace.id).single();
  if (!o || o.status !== "payment_confirmed") redirect(`/dashboard/orders/${id}`);
  const admin = supabaseAdmin();
  await admin.from("orders").update({ status: "order_fulfilled" }).eq("id", id).eq("status", "payment_confirmed");
  await admin.from("financial_audit_logs").insert({ workspace_id: ctx.workspace.id, actor_id: ctx.user.id, action: "order.fulfilled", entity: "order", entity_id: o.reference });
  revalidatePath(`/dashboard/orders/${id}`);
}

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireWorkspace();
  const { data: o } = await ctx.db.from("orders").select("*, customers(name,phone,email)").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!o) notFound();
  const [{ data: items }, { data: pays }, { data: log }, { data: msgs }] = await Promise.all([
    ctx.db.from("order_items").select("*").eq("order_id", id),
    ctx.db.from("payments").select("*").eq("order_id", id).order("created_at"),
    ctx.db.from("financial_audit_logs").select("action,created_at,details").eq("workspace_id", ctx.workspace.id).eq("entity_id", o.reference).order("created_at"),
    o.conversation_id ? ctx.db.from("messages").select("role,content,created_at").eq("conversation_id", o.conversation_id).order("created_at").limit(40) : Promise.resolve({ data: [] as { role: string; content: { text: string }; created_at: string }[] }),
  ]);
  const c = o.customers as { name: string | null; phone: string | null; email: string | null } | null;
  return (
    <>
      <div className="page-head">
        <div><Link href="/dashboard/orders" style={{ fontSize: 14 }}>← Orders</Link><h1 className="mono" style={{ fontFamily: "var(--f-mono)" }}>{o.reference}</h1></div>
        <div className="row-actions"><StatusChip status={o.status} />
          {o.status === "payment_confirmed" && canManage(ctx) && <form action={markFulfilled}><input type="hidden" name="id" value={o.id} /><button className="btn btn-ink btn-sm">Mark fulfilled</button></form>}
        </div>
      </div>
      <div className="two">
        <div className="panel">
          <h2>Items</h2>
          <div className="table-wrap"><table>
            <tbody>{items?.map((i) => <tr key={i.id}><td>{i.quantity} × {i.name}</td><td className="num">{formatNaira(i.line_total_kobo)}</td></tr>)}
              {o.discount_kobo > 0 && <tr><td>Discount</td><td className="num">−{formatNaira(o.discount_kobo)}</td></tr>}
              <tr><td><b>Total</b></td><td className="num"><b>{formatNaira(o.total_kobo)}</b></td></tr></tbody>
          </table></div>
          <dl className="kv"><dt>Customer</dt><dd>{c?.name ?? "—"} {c?.phone ?? ""} {c?.email ?? ""}</dd>
            <dt>Approved by customer</dt><dd>{o.customer_approved_at ? new Date(o.customer_approved_at).toLocaleString("en-NG") : "not yet"}</dd>
            <dt>Pay by</dt><dd>{o.expires_at ? new Date(o.expires_at).toLocaleString("en-NG") : "—"}</dd></dl>
          <h2>Payments</h2>
          {pays?.length ? pays.map((p) => <div key={p.id} className="row-actions"><span className={`chip ${p.status === "confirmed" ? "chip-ok" : p.status === "pending" ? "" : "chip-bad"}`}>{p.status}</span><span className="mono">{p.method} · {formatNaira(p.amount_kobo)}</span></div>) : <p style={{ color: "var(--ink-50)" }}>None yet.</p>}
          <h2>History</h2>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>{log?.map((l, i) => <li key={i}><span className="mono">{new Date(l.created_at).toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" })}</span> {l.action}</li>)}</ul>
        </div>
        <div className="panel">
          <h2>Conversation</h2>
          {msgs?.length ? <div style={{ display: "grid", gap: 8 }}>{msgs.map((m, i) => (
            <div key={i} style={{ justifySelf: m.role === "user" ? "start" : "end", maxWidth: "85%", padding: "10px 14px", borderRadius: 14, background: m.role === "user" ? "var(--paper)" : "var(--mint)", fontSize: 14, whiteSpace: "pre-wrap" }}>{(m.content as { text: string }).text}</div>
          ))}</div> : <p style={{ color: "var(--ink-50)" }}>No chat linked.</p>}
        </div>
      </div>
    </>
  );
}
