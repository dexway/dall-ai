import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { formatNaira } from "@/lib/money";
import { StatusChip } from "@/lib/status";
import { serverEnv } from "@/lib/env";

export const metadata = { title: "Overview" };

export default async function Overview() {
  const { db, workspace } = await requireWorkspace();
  const ws = workspace.id;
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [paid, awaiting, toCheck, chats, recent, agent, items, bank] = await Promise.all([
    db.from("payments").select("amount_kobo").eq("workspace_id", ws).eq("status", "confirmed").gte("created_at", since),
    db.from("orders").select("*", { count: "exact", head: true }).eq("workspace_id", ws).eq("status", "awaiting_payment"),
    db.from("payment_evidence").select("*", { count: "exact", head: true }).eq("workspace_id", ws).eq("status", "pending"),
    db.from("conversations").select("*", { count: "exact", head: true }).eq("workspace_id", ws).gte("created_at", since),
    db.from("orders").select("id,reference,status,total_kobo,created_at").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(6),
    db.from("agents").select("name").eq("workspace_id", ws).order("created_at").limit(1).single(),
    db.from("catalogue_items").select("*", { count: "exact", head: true }).eq("workspace_id", ws),
    db.from("business_payment_settings").select("account_number").eq("workspace_id", ws).maybeSingle(),
  ]);
  const noBank = (items.count ?? 0) > 0 && !bank.data?.account_number;
  const revenue = (paid.data ?? []).reduce((s, p) => s + Number(p.amount_kobo), 0);
  const chatUrl = `${serverEnv.siteUrl()}/chat/${workspace.slug}`;

  return (
    <>
      <div className="page-head">
        <div><h1>Good to see you</h1><p>Last 30 days for {workspace.name}. Every number here comes from real orders and payments.</p></div>
        <a className="btn btn-ink" href={`/chat/${workspace.slug}`} target="_blank" rel="noreferrer">Open {agent.data?.name ?? "assistant"}&apos;s chat ↗</a>
      </div>

      {noBank && <div className="notice notice-bad" role="alert"><b>Your assistant can't take orders yet.</b> It has products to sell but no bank account to send customers. <Link href="/dashboard/settings">Add your bank account →</Link></div>}

      {(items.count ?? 0) === 0 && (
        <div className="panel panel-dark">
          <h2>Three steps to your first sale</h2>
          <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6, color: "var(--mint-70)" }}>
            <li><Link href="/dashboard/agent" style={{ color: "var(--lime)" }}>Name your assistant</Link> and choose how it sounds.</li>
            <li><Link href="/dashboard/catalogue" style={{ color: "var(--lime)" }}>Add what you sell</Link> with prices.</li>
            <li><Link href="/dashboard/settings" style={{ color: "var(--lime)" }}>Add your bank account</Link> (and Paystack if you have it), then test the chat.</li>
          </ol>
        </div>
      )}

      <div className="stats">
        <div className="stat"><span>Confirmed sales</span><b>{formatNaira(revenue)}</b></div>
        <div className="stat"><span>Awaiting payment</span><b>{awaiting.count ?? 0}</b></div>
        <div className={`stat${(toCheck.count ?? 0) > 0 ? " attn" : ""}`}><span>Receipts to check</span><b>{toCheck.count ?? 0}</b>{(toCheck.count ?? 0) > 0 && <Link href="/dashboard/payments">Review now →</Link>}</div>
        <div className="stat"><span>Conversations</span><b>{chats.count ?? 0}</b></div>
      </div>

      <div className="panel">
        <div className="page-head"><h2>Recent orders</h2><Link href="/dashboard/orders">All orders →</Link></div>
        {recent.data?.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Reference</th><th>Status</th><th className="num">Total</th><th>When</th></tr></thead>
            <tbody>{recent.data.map((o) => (
              <tr key={o.id}><td className="mono"><Link href={`/dashboard/orders/${o.id}`}>{o.reference}</Link></td><td><StatusChip status={o.status} /></td>
                <td className="num">{formatNaira(o.total_kobo)}</td><td>{new Date(o.created_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <div className="empty">No orders yet. Share your chat link to get the first one:<code className="mono">{chatUrl}</code></div>}
      </div>
    </>
  );
}
