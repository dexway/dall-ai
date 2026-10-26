import { requireWorkspace, canManage } from "@/lib/workspace";
import { formatNaira } from "@/lib/money";
import { TOP_UPS, freeMode } from "@/lib/config";
import TopUpButton from "./TopUpButton";
import { supabaseAdmin } from "@/lib/supabase/server";
import { confirmTopUp } from "@/lib/payments";

export const metadata = { title: "Usage & billing" };

const FEATURE: Record<string, string> = { chat: "Customer chats", receipt_check: "Receipt reading", launch_kit: "Launch kit captions", agent_test: "Tests" };

export default async function Billing({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireWorkspace();
  const sp = await searchParams;
  const ws = ctx.workspace.id;
  if (sp.topup === "ok") {
    // Back from Paystack: verify this workspace's recent pending top-ups now (idempotent; the webhook may also do it).
    const { data: pend } = await supabaseAdmin().from("credit_top_up_orders").select("reference").eq("workspace_id", ws).eq("status", "pending")
      .gte("created_at", new Date(Date.now() - 3600_000).toISOString());
    for (const t of pend ?? []) { try { await confirmTopUp(t.reference); } catch { /* webhook will retry */ } }
  }
  const [{ data: bal }, { data: sub }, { data: events }, { data: ledger }] = await Promise.all([
    ctx.db.rpc("credit_balance", { ws }),
    ctx.db.from("platform_subscriptions").select("status,current_period_start,current_period_end,platform_plans(name,monthly_credits,price_kobo)").eq("workspace_id", ws).single(),
    ctx.db.from("ai_usage_events").select("feature,credits_consumed,status,created_at,model,input_tokens,output_tokens").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(200),
    ctx.db.from("usage_credit_ledger").select("kind,delta,note,created_at").eq("workspace_id", ws).in("kind", ["grant", "topup", "adjustment"]).order("created_at", { ascending: false }).limit(20),
  ]);
  const { data: paidPlans } = await ctx.db.from("platform_plans").select("id,name,price_kobo,monthly_credits").eq("is_trial", false).eq("active", true).order("price_kobo");
  const plan = sub?.platform_plans as unknown as { name: string; monthly_credits: number; price_kobo: number } | null;
  const balance = Number(bal ?? 0);
  const allowance = Number(plan?.monthly_credits ?? 0);
  const periodStart = sub ? new Date(sub.current_period_start) : new Date(0);
  const inPeriod = (events ?? []).filter((e) => new Date(e.created_at) >= periodStart);
  const used = inPeriod.reduce((s, e) => s + Number(e.credits_consumed), 0);
  const byFeature = Object.entries(inPeriod.reduce<Record<string, number>>((m, e) => ({ ...m, [e.feature]: (m[e.feature] ?? 0) + Number(e.credits_consumed) }), {})).sort((a, b) => b[1] - a[1]);
  const low = allowance > 0 && balance / allowance < 0.2;
  const fmt = (n: number) => n.toLocaleString("en-NG", { maximumFractionDigits: 2 });

  return (
    <>
      <div className="page-head"><div><h1>Usage & billing</h1><p>Your AI credits pay for your assistant&apos;s replies. This is separate from your own sales, which go straight to your account.</p></div></div>
      {freeMode() && (
        <div style={{ background: "#14231F", color: "#F4F0E7", borderRadius: 14, padding: "16px 18px", marginBottom: 16, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ background: "#C8EE72", color: "#14231F", fontWeight: 800, fontSize: 12, letterSpacing: ".06em", borderRadius: 999, padding: "5px 10px" }}>FREE EARLY ACCESS</span>
          <span style={{ flex: 1, minWidth: 220, fontSize: 14.5 }}>Dall AI is free while we&apos;re in early access. Your assistant keeps replying without using credits, and no card is needed. You can still buy credits below for later.</span>
        </div>
      )}
      {sp.topup === "ok" && <div className="notice notice-info" role="status">Payment received by Paystack. Credits appear here as soon as we verify it (usually within a minute).</div>}
      {low && <div className="notice notice-bad" role="alert">You have less than 20% of your credits left. When they run out, your assistant stops replying until you top up.</div>}

      <div className="stats">
        <div className={`stat${low ? " attn" : ""}`}><span>Credits left</span><b>{fmt(balance)}</b></div>
        <div className="stat"><span>Used this period</span><b>{fmt(used)}</b></div>
        <div className="stat"><span>Plan</span><b style={{ fontSize: 22 }}>{plan?.name ?? "—"}</b><span>{plan ? `${fmt(allowance)} credits${plan.price_kobo ? ` · ${formatNaira(plan.price_kobo)}/mo` : ""}` : ""}</span></div>
        <div className="stat"><span>Period ends</span><b style={{ fontSize: 22 }}>{sub ? new Date(sub.current_period_end).toLocaleDateString("en-NG", { dateStyle: "medium" }) : "—"}</b><span>{sub?.status}</span></div>
      </div>

      <div className="two">
        <div className="panel">
          <h2>What used credits</h2>
          {byFeature.length ? <div className="table-wrap"><table><tbody>
            {byFeature.map(([f, c]) => <tr key={f}><td>{FEATURE[f] ?? f}</td><td className="num">{fmt(c)}</td></tr>)}
          </tbody></table></div> : <p style={{ color: "var(--ink-50)" }}>No usage yet this period.</p>}
          <p style={{ fontSize: 13, color: "var(--ink-50)" }}>A typical customer message uses 1–3 credits; creating an order or reading a receipt uses a little more. Failed replies cost nothing.</p>
        </div>
        <div className="panel">
          <h2>{sub?.status === "active" ? "Renew or change plan" : "Choose a plan"}</h2>
          {canManage(ctx) && <div style={{ display: "grid", gap: 10 }}>
            {(paidPlans ?? []).map((pl) => <TopUpButton key={pl.id} pack={`plan:${pl.id}`} label={`${pl.name} · ${Number(pl.monthly_credits).toLocaleString()} credits / 30 days`} price={formatNaira(pl.price_kobo)} />)}
          </div>}
          <h2 style={{ marginTop: 8 }}>Top up</h2>
          {canManage(ctx) ? <div style={{ display: "grid", gap: 10 }}>
            {TOP_UPS.map((t) => <TopUpButton key={t.id} pack={t.id} label={`${t.credits.toLocaleString()} credits`} price={formatNaira(t.amount_kobo)} />)}
          </div> : <p>Ask an owner or admin to top up.</p>}
          <p style={{ fontSize: 13, color: "var(--ink-50)" }}>Paid securely with Paystack. Credits are added only after Paystack confirms the payment to us.</p>
          {ledger?.length ? <><h2 style={{ marginTop: 8 }}>Credits added</h2><ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
            {ledger.map((l, i) => <li key={i}><span className="mono">+{fmt(Number(l.delta))}</span> · {l.note} · {new Date(l.created_at).toLocaleDateString("en-NG")}</li>)}</ul></> : null}
        </div>
      </div>

      <div className="panel">
        <h2>Recent activity</h2>
        {events?.length ? <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>What</th><th>Result</th><th className="num">Credits</th></tr></thead>
          <tbody>{events.slice(0, 40).map((e, i) => (
            <tr key={i}><td>{new Date(e.created_at).toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" })}</td><td>{FEATURE[e.feature] ?? e.feature}</td>
              <td>{e.status === "succeeded" ? <span className="chip chip-ok">ok</span> : <span className="chip chip-bad">failed · not charged</span>}</td><td className="num">{fmt(Number(e.credits_consumed))}</td></tr>
          ))}</tbody>
        </table></div> : <p style={{ color: "var(--ink-50)" }}>Nothing yet.</p>}
      </div>
    </>
  );
}
