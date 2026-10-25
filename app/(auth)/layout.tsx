import Link from "next/link";
import { BRAND } from "@/lib/config";
import "./auth.css";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-side">
        <Link href="/" className="auth-logo"><span aria-hidden>d</span>{BRAND.name}</Link>
        <h2 className="hide-sm">Your assistant answers, sells <em>and checks the money.</em></h2>
        <p className="hide-sm" style={{ color: "var(--mint-70)", maxWidth: "30em" }}>No AI accounts or keys to set up. Free trial includes 150 credits.</p>
      </aside>
      <main className="auth-main">{children}</main>
    </div>
  );
}
