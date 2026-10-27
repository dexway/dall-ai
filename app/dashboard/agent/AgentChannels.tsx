import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace, canManage } from "@/lib/workspace";
import { supabaseAdmin } from "@/lib/supabase/server";

const LABEL: Record<string, string> = { whatsapp: "WhatsApp", facebook: "Messenger", instagram: "Instagram DMs" };
const NEEDS: Record<string, string[]> = {
  whatsapp: ["whatsapp_business_messaging", "whatsapp_business_management"],
  facebook: ["pages_messaging", "pages_manage_metadata", "pages_show_list"],
  instagram: ["instagram_basic", "instagram_manage_messages", "pages_manage_metadata"],
};

async function setDeployed(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/agent?error=role");
  const id = String(formData.get("id") ?? "");
  const to = formData.get("to") === "active" ? "active" : "paused";
  const { data: c } = await supabaseAdmin().from("channel_connections").update({ status: to }).eq("id", id).eq("workspace_id", ctx.workspace.id).neq("status", "needs_reconnect").select("provider,external_id").maybeSingle();
  if (c) await supabaseAdmin().from("financial_audit_logs").insert({ workspace_id: ctx.workspace.id, actor_id: ctx.user.id, action: `channel.${to === "paused" ? "paused" : "resumed"}`, entity: "channel", entity_id: c.external_id, details: { provider: c.provider, from: "agent_channels" } });
  revalidatePath("/dashboard/agent");
  redirect("/dashboard/agent?saved=1#channels");
}

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** Where this agent is deployed, and whether each channel is actually healthy. Reads real data only. */
export default async function AgentChannels({ workspaceId, agentName }: { workspaceId: string; agentName: string }) {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [{ data: conns }, { data: events }, { data: errs }] = await Promise.all([
    db.from("channel_connections").select("id,provider,external_id,display_name,status,scopes,last_inbound_at,last_outbound_at,last_error,last_error_at").eq("workspace_id", workspaceId).order("provider"),
    db.from("webhook_events").select("provider,status,received_at,payload").eq("workspace_id", workspaceId).gte("received_at", since).order("received_at", { ascending: false }).limit(500),
    db.from("integration_errors").select("source,message,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(5),
  ]);
  const evFor = (c: { provider: string; external_id: string }) => (events ?? []).filter((e) => e.provider === c.provider && (e.payload as { accountId?: string } | null)?.accountId === c.external_id);

  return (
    <section className="panel" id="channels">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
        <h2 style={{ margin: 0 }}>Agent channels</h2>
        <Link href="/dashboard/connect" style={{ fontSize: 13 }}>Connect another channel →</Link>
      </div>
      <p style={{ color: "var(--ink-70)", fontSize: 14, marginTop: 4 }}>{agentName} runs with the same instructions, catalogue and knowledge on every channel below. Switch replies off on a channel to keep messages coming into your Inbox without the assistant answering.</p>
      {!conns?.length ? <div className="empty">No Meta channels yet. <Link href="/dashboard/connect">Connect WhatsApp, Messenger or Instagram</Link>. Your website chat is always on.</div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Channel</th><th>Assistant</th><th>Webhook (7 days)</th><th>Last message</th><th>Permissions</th><th></th></tr></thead>
          <tbody>{conns.map((c) => {
            const ev = evFor(c);
            const failed = ev.filter((e) => e.status === "failed").length;
            const granted = c.scopes as string[] | null;
            const missing = granted?.length ? NEEDS[c.provider]?.filter((s) => !granted.includes(s)) ?? [] : null;
            const health = c.status === "needs_reconnect" ? ["Lost connection", "#A52A1E"] : failed ? [`${failed} failed event(s)`, "#8A5A0B"] : ev.length ? ["Receiving", "#1E7A45"] : ["No events yet", "#5B6461"];
            return (
              <tr key={c.id}>
                <td><b>{LABEL[c.provider] ?? c.provider}</b><br /><small>{c.display_name ?? c.external_id}</small></td>
                <td>{c.status === "active" ? <span style={{ color: "#1E7A45", fontWeight: 600 }}>● Replying</span> : c.status === "paused" ? <span style={{ color: "#8A5A0B", fontWeight: 600 }}>● Off (inbox only)</span> : <span style={{ color: "#A52A1E", fontWeight: 600 }}>● Reconnect needed</span>}
                  {c.last_error && c.status === "needs_reconnect" ? <><br /><small title={c.last_error}>{c.last_error.slice(0, 80)}</small></> : null}</td>
                <td><span style={{ color: health[1], fontWeight: 600 }}>{health[0]}</span><br /><small>{ev.length} event(s)</small></td>
                <td><small>In: {ago(c.last_inbound_at)}<br />Out: {ago(c.last_outbound_at)}</small></td>
                <td>{missing === null ? <small>Not recorded (reconnect to check)</small> : missing.length ? <small style={{ color: "#A52A1E" }}>Missing: {missing.join(", ")}</small> : <small style={{ color: "#1E7A45" }}>✓ All granted</small>}</td>
                <td>
                  {c.status === "needs_reconnect" ? <a className="btn btn-lime btn-sm" href={c.provider === "whatsapp" ? "/dashboard/connect?c=whatsapp" : "/api/meta/facebook/start"}>Reconnect</a> : (
                    <form action={setDeployed}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="to" value={c.status === "active" ? "paused" : "active"} />
                      <button className={`btn btn-sm ${c.status === "active" ? "btn-line" : "btn-lime"}`}>{c.status === "active" ? "Turn replies off" : "Turn replies on"}</button></form>
                  )}
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {(errs ?? []).length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ fontSize: 13, cursor: "pointer" }}>Recent integration errors ({errs!.length})</summary>
          <ul style={{ fontSize: 12.5, color: "var(--ink-70)", paddingLeft: 18 }}>{errs!.map((e, i) => <li key={i}><b>{e.source}</b> · {new Date(e.created_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })} — {e.message.slice(0, 200)}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
