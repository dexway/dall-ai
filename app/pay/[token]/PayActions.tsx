"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  token: string; status: string; approved: boolean; total: string; reference: string; paystack: boolean; hasPending: boolean;
  bank: { bank: string | null; name: string | null; number: string | null; note: string | null } | null;
};

export default function PayActions(p: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const payable = ["awaiting_payment", "payment_rejected", "payment_failed"].includes(p.status);

  async function post(body: unknown) {
    setBusy(true); setErr(null);
    const res = await fetch(`/api/pay/${p.token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(out.error ?? "Something went wrong."); return null; }
    return out;
  }

  if (p.status === "payment_confirmed" || p.status === "order_fulfilled")
    return <div className="notice notice-ok">Thank you! The business has your payment and will take it from here.</div>;
  if (p.status === "verification_pending" || p.hasPending)
    return <div className="notice notice-info">Your receipt is with the business. They&apos;ll confirm once they see the money in their account. You can close this page.</div>;
  if (p.status === "payment_expired")
    return <div className="notice notice-bad">This checkout has expired. Go back to the chat to get a fresh one.</div>;
  if (!payable) return null;

  if (!p.approved) return (
    <div style={{ display: "grid", gap: 10 }}>
      {p.status === "payment_rejected" && <div className="notice notice-bad">The business couldn&apos;t find your last payment. Please try again or contact them.</div>}
      <p style={{ fontSize: 14 }}>Check the items and total. Nothing is charged until you choose how to pay.</p>
      {err && <div className="notice notice-bad" role="alert">{err}</div>}
      <button className="btn btn-ink" disabled={busy} onClick={async () => { if (await post({ action: "approve" })) router.refresh(); }}>This is correct, continue to payment</button>
    </div>
  );

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const res = await fetch(`/api/pay/${p.token}`, { method: "POST", body: new FormData(e.currentTarget) });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(out.error ?? "Upload failed.");
    router.refresh();
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {err && <div className="notice notice-bad" role="alert">{err}</div>}
      {p.paystack && (
        <form style={{ display: "grid", gap: 8 }} onSubmit={async (e) => { e.preventDefault(); const email = String(new FormData(e.currentTarget).get("email")); const out = await post({ action: "paystack", email }); if (out?.url) window.location.href = out.url; }}>
          <label className="field"><span>Pay with card, bank or USSD (Paystack)</span><input id="pay-email" name="email" type="email" required className="input" placeholder="Your email for the receipt" /></label>
          <button className="btn btn-ink" disabled={busy}>Pay {p.total} securely</button>
        </form>
      )}
      {p.bank?.number && (
        <div className="bank">
          <span style={{ fontSize: 13, color: "var(--ink-70)" }}>{p.paystack ? "Or transfer" : "Transfer"} exactly <b className="mono">{p.total}</b> to</span>
          <span className="acct">{p.bank.number}</span>
          <span>{p.bank.name} · {p.bank.bank}</span>
          <span style={{ fontSize: 13 }}>Narration: <b className="mono">{p.reference}</b></span>
          {p.bank.note && <span style={{ fontSize: 13, color: "var(--ink-70)" }}>{p.bank.note}</span>}
          <button type="button" className="btn btn-line btn-sm" style={{ width: "fit-content" }} onClick={async () => { try { await navigator.clipboard.writeText(p.bank!.number!); setCopied(true); } catch { /* select manually */ } }}>{copied ? "Copied" : "Copy account number"}</button>
          <form onSubmit={upload} style={{ display: "grid", gap: 8, marginTop: 6 }}>
            <label className="field"><span>After paying, upload your receipt or screenshot</span><input id="receipt" name="receipt" type="file" required accept="image/png,image/jpeg,image/webp,application/pdf" className="input" /></label>
            <button className="btn btn-coral" disabled={busy}>{busy ? "Uploading…" : "Send receipt"}</button>
          </form>
        </div>
      )}
      {!p.paystack && !p.bank?.number && <div className="notice notice-info">This business hasn&apos;t set up payments yet. Please contact them directly.</div>}
    </div>
  );
}
