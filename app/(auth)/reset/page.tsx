"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function Reset() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr(null);
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("confirm")) { setBusy(false); return setErr("The two passwords don't match."); }
    const { error } = await supabaseBrowser().auth.updateUser({ password: String(f.get("password")) });
    setBusy(false);
    if (error) return setErr(error.message.includes("session") ? "This reset link has expired. Request a new one." : error.message);
    router.replace("/dashboard"); router.refresh();
  }
  return (
    <div className="auth-card">
      <h1>Choose a new password</h1>
      {err && <div className="notice notice-bad" role="alert">{err}</div>}
      <form onSubmit={submit}>
        <label className="field"><span>New password</span><input id="password" name="password" type="password" minLength={8} required className="input" autoComplete="new-password" /></label>
        <label className="field"><span>Repeat it</span><input id="confirm" name="confirm" type="password" minLength={8} required className="input" autoComplete="new-password" /></label>
        <button className="btn btn-ink" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
      </form>
    </div>
  );
}
