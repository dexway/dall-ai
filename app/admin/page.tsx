import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabaseUser, supabaseAdmin } from "@/lib/supabase/server";
import { formatNaira } from "@/lib/money";
import { BRAND } from "@/lib/config";
import "../dashboard/dashboard.css";

export const metadata = { title: "Platform admin", robots: { index: false } };

async function requireAdmin() {
  const db = await supabaseUser();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login?next=/admin");
  const { data } = await supabaseAdmin().from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!data) notFound(); // don't reveal the page exists
  return user;
}

async function setAi(formData: FormData) {
  "use server";
  const u = await requireAdmin();
  const db = supabaseAdmin();
  const enabled = formData.get("ai_enabled") === "true";
  const cap = Math.max(0, Number(formData.get("cap")) || 0);
  await db.from("platform_spend_limits").update({ ai_enabled: enabled, global_daily_usd_cap: cap }).eq("id", true);
  await db.from("billing_audit_logs").insert({ actor_id: u.id, action: "platform.limits", details: { ai_enabled: enabled, cap } });
  revalidatePath("/admin");
}

async function grant(formData: FormData) {
  "use server";
  const u = await requireAdmin();
  const ws = String(formData.get("ws"));
  const amount = Number(formData.get("amount"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100000 || reason.length < 3) redirect("/admin?error=grant");
  await supabaseAdmin().rpc("grant_credits", { ws, amount, p_kind: "adjustment", p_key: `admin:${crypto.randomUUID()}`, p_note: reason, p_actor: u.id });
  revalidatePath("/admin");
}

async function setStatus(formData: FormData) {
  "use server";
  const u = await requireAdmin();
  const ws = String(formData.get("ws"));
  const status = formData.get("status") === "suspended" ? "suspended" : "active";
  const db = supabaseAdmin();
  await db.from("workspaces").update({ status }).eq("id", ws);
  await db.from("billing_audit_logs").insert({ workspace_id: ws, actor_id: u.id, action: `workspace.${status}` });
  revalidatePath("/admin");
}

export default async function Admin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [{ data: limits }, { data: wss }, { data: usage }, { data: tx }, { data: subs }] = await Promise.all([
    db.from("platform_spend_limits").select("*").single(),
    db.from("workspaces").select("id,name,slug,status,created_at").order("created_at", { ascending: false }).limit(200),
    db.from("ai_usage_events").select("workspace_id,est_cost_usd,credits_consumed,status,model").gte("created_at", since),
    db.from("platform_payment_transactions").select("workspace_id,amount_kobo,status").gte("created_at", since),
    db.from("platform_subscriptions").select("workspace_id,status,plan_id"),
  ]);
  const cost = (usage ?? []).reduce((s, e) => s + Number(e.est_cost_usd), 0);
  const failed = (usage ?? []).filter((e) => e.status === "failed").length;
  const revenueKobo = (tx ?? []).filter((t) => t.status === "success").reduce((s, t) => s + Number(t.amount_kobo), 0);
  const fx = Number(process.env.ADMIN_NGN_PER_USD || 1550);
  const margin = revenueKobo / 100 - cost * fx;
  const per = new Map<string, { cost: number; credits: number; n: number }>();
  (usage ?? []).forEach((e) => { const p = per.get(e.workspace_id) ?? { cost: 0, credits: 0, n: 0 }; p.cost += Number(e.est_cost_usd); p.credits += Number(e.credits_consumed); p.n++; per.set(e.workspace_id, p); });
  const subBy = new Map((subs ?? []).map((s) => [s.workspace_id, s]));

  return (
    <div className="main" style={{ maxWidth: 1200, margin: "0 auto" }}>
      <div className="page-head"><div><h1>{BRAND.name} platform admin</h1><p>Last 30 days. Costs are estimates from the rate card; reconcile against the Anthropic Console invoice.</p></div><a className="btn btn-line" href="/admin/creative">Creative Director models & quotas →</a></div>
      {sp.error && <div className="notice notice-bad">Enter a non-zero amount (max 100,000) and a reason.</div>}
      <div className="stats">
        <div className="stat"><span>Workspaces</span><b>{wss?.length ?? 0}</b></div>
        <div className="stat"><span>Paying subscriptions</span><b>{(subs ?? []).filter((s) => s.status === "active").length}</b></div>
        <div className="stat"><span>Est. AI cost</span><b>${cost.toFixed(2)}</b></div>
        <div className="stat"><span>Top-up revenue</span><b>{formatNaira(revenueKobo)}</b></div>
        <div className={`stat${margin < 0 ? " attn" : ""}`}><span>Est. gross margin (@₦{fx}/$)</span><b>{formatNaira(Math.round(margin * 100))}</b></div>
        <div className="stat"><span>Failed AI requests</span><b>{failed}</b></div>
      </div>

      <form action={setAi} className="panel panel-dark">
        <h2>Emergency controls</h2>
        <div className="row-actions">
          <label className="chip" style={{ background: "var(--forest)", color: "var(--mint)" }}><input type="radio" name="ai_enabled" value="true" defaultChecked={limits?.ai_enabled} /> AI on</label>
          <label className="chip" style={{ background: "var(--forest)", color: "var(--mint)" }}><input type="radio" name="ai_enabled" value="false" defaultChecked={!limits?.ai_enabled} /> AI off for everyone</label>
          <label className="field" style={{ minWidth: 200 }}><span style={{ color: "var(--mint-70)" }}>Global daily cap (USD)</span><input id="cap" name="cap" type="number" step="1" min={0} defaultValue={limits?.global_daily_usd_cap} className="input" /></label>
          <button className="btn btn-lime">Apply</button>
        </div>
      </form>

      <div className="table-wrap"><table>
        <thead><tr><th>Workspace</th><th>Plan</th><th className="num">AI requests</th><th className="num">Credits used</th><th className="num">Est. cost</th><th>Credits</th><th>Status</th></tr></thead>
        <tbody>{wss?.map((w) => { const p = per.get(w.id); const s = subBy.get(w.id); return (
          <tr key={w.id}>
            <td><b>{w.name}</b><div className="mono" style={{ fontSize: 12, color: "var(--ink-50)" }}>{w.slug}</div></td>
            <td>{s?.plan_id} · {s?.status}</td><td className="num">{p?.n ?? 0}</td><td className="num">{(p?.credits ?? 0).toFixed(1)}</td><td className="num">${(p?.cost ?? 0).toFixed(3)}</td>
            <td><form action={grant} className="row-actions"><input type="hidden" name="ws" value={w.id} />
              <input name="amount" type="number" className="input" style={{ width: 90, minHeight: 34 }} placeholder="±" aria-label="Credits" />
              <input name="reason" className="input" style={{ width: 140, minHeight: 34 }} placeholder="reason" aria-label="Reason" />
              <button className="btn btn-line btn-sm">Grant</button></form></td>
            <td><form action={setStatus}><input type="hidden" name="ws" value={w.id} /><input type="hidden" name="status" value={w.status === "active" ? "suspended" : "active"} />
              <button className={`btn btn-sm ${w.status === "active" ? "btn-line" : "btn-coral"}`}>{w.status === "active" ? "Suspend" : "Reactivate"}</button></form></td>
          </tr>); })}</tbody>
      </table></div>
    </div>
  );
}
