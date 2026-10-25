"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email")).trim();
    const password = String(f.get("password"));
    const supabase = supabaseBrowser();
    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: String(f.get("name")).trim() }, emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
      });
      setBusy(false);
      if (error) return setError(error.message);
      if (!data.session) return setSent(true);  // email confirmation is on
      router.replace("/onboarding");
      router.refresh();
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setBusy(false);
      if (error) return setError(error.message === "Invalid login credentials" ? "That email and password don't match. Check them and try again." : error.message);
      router.replace(params.get("next") || "/dashboard");
      router.refresh();
    }
  }

  if (sent) {
    return (
      <div className="auth-card">
        <h1>Check your email</h1>
        <p className="muted">We sent you a confirmation link. Open it on this device to finish creating your account.</p>
      </div>
    );
  }

  return (
    <div className="auth-card">
      <h1>{mode === "signup" ? "Create your workspace" : "Welcome back"}</h1>
      <p className="muted">{mode === "signup" ? "Takes about two minutes. No card needed." : "Log in to manage your assistant, orders and payments."}</p>
      {error && <div className="notice notice-bad" role="alert">{error}</div>}
      <form onSubmit={onSubmit}>
        {mode === "signup" && (
          <label className="field"><span>Your name</span><input id="name" name="name" className="input" required autoComplete="name" /></label>
        )}
        <label className="field"><span>Email</span><input id="email" name="email" type="email" className="input" required autoComplete="email" /></label>
        <label className="field"><span>Password</span>
          <input id="password" name="password" type="password" className="input" required minLength={8} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
          {mode === "signup" && <small>At least 8 characters.</small>}
        </label>
        <button className="btn btn-ink" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create account" : "Log in"}</button>
      </form>
      <p className="muted" style={{ fontSize: 14 }}>
        {mode === "signup" ? <>Already have an account? <Link href="/login">Log in</Link></> : <>New here? <Link href="/signup">Create a free workspace</Link> · <Link href="/forgot">Forgot password?</Link></>}
      </p>
    </div>
  );
}
