import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { formatNaira } from "@/lib/money";
import { ORDER_STATUS, StatusChip } from "@/lib/status";

export const metadata = { title: "Orders" };

export default async function Orders({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { db, workspace } = await requireWorkspace();
  const { status } = await searchParams;
  let q = db.from("orders").select("id,reference,status,total_kobo,created_at,pay_on_delivery,customers(name,phone)").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(100);
  if (status && ORDER_STATUS[status]) q = q.eq("status", status);
  const { data: orders } = await q;
  const filters = ["awaiting_payment", "verification_pending", "payment_confirmed", "order_fulfilled"];
  return (
    <>
      <div className="page-head"><div><h1>Orders</h1><p>Created by your assistant from real catalogue prices. Status changes are logged.</p></div></div>
      <div className="row-actions">
        <Link href="/dashboard/orders" className={`btn btn-sm ${!status ? "btn-ink" : "btn-line"}`}>All</Link>
        {filters.map((f) => <Link key={f} href={`/dashboard/orders?status=${f}`} className={`btn btn-sm ${status === f ? "btn-ink" : "btn-line"}`}>{ORDER_STATUS[f].label}</Link>)}
      </div>
      {orders?.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>Reference</th><th>Customer</th><th>Status</th><th className="num">Total</th><th>Created</th></tr></thead>
          <tbody>{orders.map((o) => {
            const c = o.customers as unknown as { name: string | null; phone: string | null } | null;
            return (
              <tr key={o.id}><td className="mono"><Link href={`/dashboard/orders/${o.id}`}>{o.reference}</Link></td>
                <td>{c?.name ?? "—"}<div style={{ fontSize: 13, color: "var(--ink-50)" }}>{c?.phone}</div></td>
                <td><StatusChip status={o.status} />{o.pay_on_delivery && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: "#E6EEFF", color: "#1F4FD1" }}>🚚 PAY ON DELIVERY</span>}</td><td className="num">{formatNaira(o.total_kobo)}</td>
                <td>{new Date(o.created_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</td></tr>
            );
          })}</tbody>
        </table></div>
      ) : <div className="panel empty">No orders{status ? " with this status" : " yet"}.</div>}
    </>
  );
}
