"use client";
import { useState } from "react";

export default function TopUpButton({ pack, label, price }: { pack: string; label: string; price: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setBusy(true); setErr(null);
    const res = await fetch("/api/billing/topup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pack }) });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.url) { window.location.href = body.url; return; }
    setBusy(false); setErr(body.error ?? "Couldn't start payment.");
  }
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <button type="button" className="btn btn-line" onClick={go} disabled={busy} style={{ justifyContent: "space-between" }}>
        <span>{label}</span><span className="mono">{busy ? "…" : price}</span>
      </button>
      {err && <span role="alert" style={{ color: "var(--bad)", fontSize: 13 }}>{err}</span>}
    </div>
  );
}
