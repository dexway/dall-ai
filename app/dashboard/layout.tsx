import { requireWorkspace } from "@/lib/workspace";
import { BRAND } from "@/lib/config";
import SideNav from "./SideNav";
import LaunchOffer from "./LaunchOffer";
import "./dashboard.css";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireWorkspace();
  const [{ data: bal }, { data: sub }] = await Promise.all([
    ctx.db.rpc("credit_balance", { ws: ctx.workspace.id }),
    ctx.db.from("platform_subscriptions").select("plan_id, platform_plans(name, monthly_credits)").eq("workspace_id", ctx.workspace.id).single(),
  ]);
  const plan = sub?.platform_plans as unknown as { name: string; monthly_credits: number } | null;
  const balance = Number(bal ?? 0);
  const allowance = Number(plan?.monthly_credits ?? 1);
  const pct = Math.max(0, Math.min(100, (balance / allowance) * 100));

  return (
    <div className="dash">
      <aside className="side">
        <div className="ws"><b>{ctx.workspace.name}</b><span>{BRAND.name} · {plan?.name ?? "No plan"}</span></div>
        <SideNav />
        <div className="credits">
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>AI credits</span><b className="mono" style={{ color: "var(--white)" }}>{balance.toLocaleString("en-NG", { maximumFractionDigits: 1 })}</b></div>
          <div className={`meter${pct < 20 ? " low" : ""}`} role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Credits left"><i style={{ width: `${pct}%` }} /></div>
          {pct < 20 && <span style={{ color: "var(--coral)" }}>Running low. Top up in Usage & billing.</span>}
        </div>
        <form action="/auth/signout" method="post"><button>Log out</button></form>
      </aside>
      <div className="main">{children}</div>
      <LaunchOffer workspaceId={ctx.workspace.id} name={ctx.workspace.name} signedInAt={ctx.user.signedInAt} />
    </div>
  );
}
