import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace, canManage } from "@/lib/workspace";
import { formatNaira } from "@/lib/money";
import { FLAG_TEXT } from "@/lib/status";

export const metadata = { title: "Payments to check" };

async function review(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/payments?error=role");
  const decision = formData.get("decision") === "approved" ? "approved" : "rejected";
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 3) redirect("/dashboard/payments?error=reason");
  // The database function re-checks the role, locks the rows, and writes the audit log.
  const { error } = await ctx.db.rpc("review_evidence", { p_evidence: String(formData.get("id")), p_decision: decision, p_reason: reason });
  if (error) redirect(`/dashboard/payments?error=${error.message.includes("ALREADY") ? "done" : "save"}`);
  revalidatePath("/dashboard/payments");
  redirect(`/dashboard/payments?ok=${decision}`);
}

type Extracted = { amount_naira?: number | null; reference?: string | null; date?: string | null; sender_name?: string | null; recipient_name?: string | null; recipient_account?: string | null; bank?: string | null; status_text?: string | null } | null;

export default async function Payments({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireWorkspace();
  const sp = await searchParams;
  const ws = ctx.workspace.id;
  const [{ data: pending }, { data: recent }] = await Promise.all([
    ctx.db.from("payment_evidence").select("id,file_path,extracted,flags,created_at,orders(id,reference,total_kobo)").eq("workspace_id", ws).eq("status", "pending").order("created_at"),
    ctx.db.from("payments").select("id,method,amount_kobo,status,created_at,verified_at,provider_reference,orders(id,reference)").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(30),
  ]);
  const urls = new Map<string, string>();
  if (pending?.length) {
    const { data } = await ctx.db.storage.from("payment-evidence").createSignedUrls(pending.map((p) => p.file_path), 600);
    data?.forEach((d) => d.path && d.signedUrl && urls.set(d.path, d.signedUrl));
  }
  const msg: Record<string, string> = { role: "Only owners and admins can approve payments.", reason: "Write a short reason (e.g. 'Seen in GTBank app').", done: "Someone already reviewed that receipt.", save: "Couldn't save the decision. Try again." };

  return (
    <>
      <div className="page-head"><div><h1>Payments to check</h1><p>Open your bank app, confirm the money arrived, then approve. The order is only marked paid after you do.</p></div></div>
      {sp.ok && <div className="notice notice-ok" role="status">{sp.ok === "approved" ? "Approved. The order is now paid and your assistant will tell the customer." : "Rejected. The customer will be asked to pay again or contact you."}</div>}
      {sp.error && <div className="notice notice-bad" role="alert">{msg[sp.error] ?? "Something went wrong."}</div>}

      {pending?.length ? pending.map((p) => {
        const o = p.orders as unknown as { id: string; reference: string; total_kobo: number };
        const x = p.extracted as Extracted;
        const url = urls.get(p.file_path);
        return (
          <article key={p.id} className="panel">
            <div className="page-head"><h2>Order <Link className="mono" href={`/dashboard/orders/${o.id}`}>{o.reference}</Link> · expects <span className="mono">{formatNaira(o.total_kobo)}</span></h2>
              <span className="chip chip-warn">Waiting for you</span></div>
            <div className="two">
              <div>{url ? (p.file_path.endsWith(".pdf") ? <a className="btn btn-line" href={url} target="_blank" rel="noreferrer">Open PDF receipt ↗</a>
                // eslint-disable-next-line @next/next/no-img-element
                : <img className="ev-img" src={url} alt={`Transfer receipt for ${o.reference}`} />) : <p>Receipt file unavailable.</p>}</div>
              <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
                <div style={{ display: "grid", gap: 6 }}>
                  {p.flags.length === 0
                    ? <span className="chip chip-ok">Everything we could read matches</span>
                    : p.flags.map((f: string) => <span key={f} className={`chip ${f.startsWith("amount") || f.includes("mismatch") || f.includes("status") ? "chip-bad" : "chip-warn"}`}>{FLAG_TEXT[f] ?? f}</span>)}
                </div>
                {x && <dl className="kv">
                  <dt>Amount</dt><dd>{x.amount_naira != null ? formatNaira(Math.round(x.amount_naira * 100)) : "—"}</dd>
                  <dt>To</dt><dd>{x.recipient_name ?? "—"} {x.recipient_account ?? ""}</dd>
                  <dt>From</dt><dd>{x.sender_name ?? "—"}</dd>
                  <dt>Bank</dt><dd>{x.bank ?? "—"}</dd><dt>Date</dt><dd>{x.date ?? "—"}</dd>
                  <dt>Reference</dt><dd>{x.reference ?? "—"}</dd><dt>Says</dt><dd>{x.status_text ?? "—"}</dd>
                </dl>}
                <p style={{ fontSize: 13, color: "var(--ink-50)" }}>Read automatically as a guide. It is not proof: confirm in your bank app.</p>
                <form action={review} style={{ display: "grid", gap: 10 }}>
                  <input type="hidden" name="id" value={p.id} />
                  <label className="field"><span>Reason (saved to the audit log)</span><input id={`reason-${p.id}`} name="reason" className="input" required minLength={3} placeholder="e.g. ₦140,000 seen in Moniepoint at 08:02" /></label>
                  <div className="row-actions">
                    <button className="btn btn-ink" name="decision" value="approved">Money received: approve</button>
                    <button className="btn btn-line" name="decision" value="rejected">Not received: reject</button>
                  </div>
                </form>
              </div>
            </div>
          </article>
        );
      }) : <div className="panel empty">Nothing to check. New transfer receipts appear here.</div>}

      <div className="panel">
        <h2>Recent payments</h2>
        {recent?.length ? <div className="table-wrap"><table>
          <thead><tr><th>Order</th><th>Method</th><th>Status</th><th className="num">Amount</th><th>Verified</th></tr></thead>
          <tbody>{recent.map((p) => { const o = p.orders as unknown as { id: string; reference: string }; return (
            <tr key={p.id}><td className="mono"><Link href={`/dashboard/orders/${o.id}`}>{o.reference}</Link></td><td>{p.method === "paystack" ? "Paystack" : "Bank transfer"}</td>
              <td><span className={`chip ${p.status === "confirmed" ? "chip-ok" : p.status === "pending" ? "" : "chip-bad"}`}>{p.status}</span></td>
              <td className="num">{formatNaira(p.amount_kobo)}</td><td>{p.verified_at ? new Date(p.verified_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }) : "—"}</td></tr>); })}</tbody>
        </table></div> : <p style={{ color: "var(--ink-50)" }}>No payments yet.</p>}
      </div>
    </>
  );
}
