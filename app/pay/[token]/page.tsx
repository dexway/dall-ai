import { notFound } from "next/navigation";
import { loadCheckout } from "@/lib/checkout";
import { confirmCommercePayment } from "@/lib/payments";
import { formatNaira } from "@/lib/money";
import { BRAND } from "@/lib/config";
import PayActions from "./PayActions";
import "../../public.css";

export const metadata = { title: "Checkout", robots: { index: false } };

const HEADLINE: Record<string, string> = {
  awaiting_payment: "Review your order",
  verification_pending: "We're checking your payment",
  payment_evidence_submitted: "We're checking your payment",
  payment_confirmed: "Payment confirmed ✓",
  order_fulfilled: "Order complete ✓",
  payment_rejected: "We couldn't confirm your payment",
  payment_failed: "Payment didn't go through",
  payment_expired: "This checkout has expired",
};

export default async function Pay({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ paid?: string; reference?: string; trxref?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  let c = await loadCheckout(token);
  if (!c) notFound();
  // Back from Paystack: verify server-side right away instead of waiting for the webhook.
  const ref = sp.reference ?? sp.trxref;
  if (sp.paid && ref && ref.startsWith(c.order.reference)) {
    try { await confirmCommercePayment(c.order.workspace_id, ref); c = (await loadCheckout(token))!; } catch { /* webhook will finish it */ }
  }
  const { order, items, business, bank } = c;

  return (
    <div className="pub">
      <div className="pub-card">
        <div className="pay-card">
          <span className="eyebrow" style={{ color: "var(--ink)" }}>{business.name} · <span className="mono">{order.reference}</span></span>
          <h1>{HEADLINE[order.status] ?? "Your order"}</h1>
          <div className="table-wrap"><table><tbody>
            {items.map((i, n) => <tr key={n}><td>{i.quantity} × {i.name}</td><td className="num">{formatNaira(i.line_total_kobo)}</td></tr>)}
            {order.discount_kobo > 0 && <tr><td>Discount</td><td className="num">−{formatNaira(order.discount_kobo)}</td></tr>}
          </tbody></table></div>
          <div className="pay-total"><span>Total</span><span className="mono">{formatNaira(order.total_kobo)}</span></div>
          <PayActions token={token} status={order.status} approved={Boolean(order.customer_approved_at)} total={formatNaira(order.total_kobo)}
            reference={order.reference} bank={bank ? { bank: bank.bank_name, name: bank.account_name, number: bank.account_number, note: bank.transfer_instructions } : null}
            paystack={c.paystackReady} hasPending={c.evidence.some((e) => e.status === "pending")} />
          {order.expires_at && order.status === "awaiting_payment" && <p style={{ fontSize: 13, color: "var(--ink-50)" }}>Pay by {new Date(order.expires_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}.</p>}
        </div>
        <p className="powered">Secure checkout · we never ask for your card PIN or OTP in chat · {BRAND.name}</p>
      </div>
    </div>
  );
}
