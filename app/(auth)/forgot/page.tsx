"use client";
import { useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function Forgot() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr(null);
    const email = String(new FormData(e.currentTarget).get("email")).trim();
    const { error } = await supabaseBrowser().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback?next=/reset` });
    setBusy(false);
    if (error) return setErr(error.message);
    setSent(true);
  }
  return (
    <div className="auth-card">
      <h1>Reset your password</h1>
      {sent ? <p className="muted">If that email has an account, a reset link is on its way. Open it on this device.</p> : <>
        <p className="muted">We&apos;ll email you a link to choose a new password.</p>
        {err && <div className="notice notice-bad" role="alert">{err}</div>}
        <form onSubmit={submit}>
          <label className="field"><span>Email</span><input id="email" name="email" type="email" required className="input" autoComplete="email" /></label>
          <button className="btn btn-ink" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
        </form></>}
      <p className="muted" style={{ fontSize: 14 }}><Link href="/login">Back to log in</Link></p>
    </div>
  );
}
