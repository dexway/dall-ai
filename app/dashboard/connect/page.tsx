import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace, canManage } from "@/lib/workspace";
import { supabaseAdmin } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";
import { exchangeEmbeddedSignupCode, subscribeWaba, phoneNumberInfo } from "@/lib/meta";
import ConnectWhatsApp from "./ConnectWhatsApp";

export const metadata = { title: "Connect with Meta" };

const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", facebook: "Facebook Page", instagram: "Instagram" };
const CHANNEL_DOES: Record<string, string> = {
  whatsapp: "Reads and replies to WhatsApp messages customers send this number — answers from your catalogue, quotes prices, and takes bank-transfer orders.",
  facebook: "Reads and replies to Messenger DMs on this Page — answers from your catalogue, quotes prices, and takes bank-transfer orders.",
  instagram: "Reads and replies to Instagram DMs on this account — answers from your catalogue, quotes prices, and takes bank-transfer orders.",
};

function rel(iso: string | null): string {
  if (!iso) return "no activity yet";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function who(channel: string, ref: string | null, name: string | null, phone: string | null): string {
  if (name) return name;
  if (channel === "whatsapp") return phone ?? (ref ? `+${ref}` : "a customer");
  return ref ? `Customer ${ref.slice(-6)}` : "a customer";
}

async function connectWhatsApp(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/connect?error=role");
  const code = String(formData.get("code") ?? "").trim();
  const wabaId = String(formData.get("waba_id") ?? "").replace(/\D/g, "");
  const phoneId = String(formData.get("phone_number_id") ?? "").replace(/\D/g, "");
  if (!code || !phoneId) redirect("/dashboard/connect?error=missing");

  const db = supabaseAdmin();
  const { data: other } = await db.from("channel_connections").select("workspace_id")
    .eq("provider", "whatsapp").eq("external_id", phoneId).maybeSingle();
  if (other && other.workspace_id !== ctx.workspace.id) redirect("/dashboard/connect?error=taken");

  let token = "";
  let label: string | null = null;
  try {
    token = await exchangeEmbeddedSignupCode(code);
    if (wabaId) await subscribeWaba(token, wabaId);
    const info = await phoneNumberInfo(token, phoneId);
    label = [info.verified_name, info.display_phone_number].filter(Boolean).join(" · ") || null;
  } catch (e) {
    console.error("[meta] whatsapp connect failed", (e as Error).message);
    redirect("/dashboard/connect?error=meta");
  }

  const { error } = await db.from("channel_connections").upsert({
    workspace_id: ctx.workspace.id, provider: "whatsapp", external_id: phoneId, display_name: label,
    access_token_enc: encryptSecret(token), status: "active",
  }, { onConflict: "provider,external_id" });
  if (error) redirect("/dashboard/connect?error=save");
  await db.from("financial_audit_logs").insert({ workspace_id: ctx.workspace.id, actor_id: ctx.user.id, action: "channel.whatsapp_connected", entity: "workspace", entity_id: ctx.workspace.id, details: { phone_number_id: phoneId } });
  revalidatePath("/dashboard/connect");
  redirect("/dashboard/connect?saved=connected");
}

// Pause or resume one channel. While paused, the assistant reads nothing and sends nothing on it.
async function setChannelStatus(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/connect?error=role");
  const provider = String(formData.get("provider") ?? "");
  const externalId = String(formData.get("external_id") ?? "");
  const to = String(formData.get("to") ?? "") === "paused" ? "paused" : "active";
  if (!provider || !externalId) redirect("/dashboard/connect?error=save");
  await supabaseAdmin().from("channel_connections").update({ status: to })
    .eq("workspace_id", ctx.workspace.id).eq("provider", provider).eq("external_id", externalId);
  await supabaseAdmin().from("financial_audit_logs").insert({ workspace_id: ctx.workspace.id, actor_id: ctx.user.id, action: `channel.${to === "paused" ? "paused" : "resumed"}`, entity: "channel", entity_id: externalId, details: { provider } });
  revalidatePath("/dashboard/connect");
  redirect(`/dashboard/connect?saved=${to === "paused" ? "paused" : "resumed"}`);
}

// Disconnect one channel: removes the saved access, so the assistant stops replying there at once.
async function disconnectChannel(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/connect?error=role");
  const provider = String(formData.get("provider") ?? "");
  const externalId = String(formData.get("external_id") ?? "");
  if (!provider || !externalId) redirect("/dashboard/connect?error=save");
  await supabaseAdmin().from("channel_connections").delete()
    .eq("workspace_id", ctx.workspace.id).eq("provider", provider).eq("external_id", externalId);
  await supabaseAdmin().from("financial_audit_logs").insert({ workspace_id: ctx.workspace.id, actor_id: ctx.user.id, action: "channel.disconnected", entity: "channel", entity_id: externalId, details: { provider } });
  revalidatePath("/dashboard/connect");
  redirect("/dashboard/connect?saved=disconnected");
}

async function disconnectAd(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/connect?error=role");
  const adAccountId = String(formData.get("ad_account_id") ?? "");
  if (!adAccountId) redirect("/dashboard/connect?error=save");
  await supabaseAdmin().from("ad_connections").delete()
    .eq("workspace_id", ctx.workspace.id).eq("ad_account_id", adAccountId);
  await supabaseAdmin().from("financial_audit_logs").insert({ workspace_id: ctx.workspace.id, actor_id: ctx.user.id, action: "ads.disconnected", entity: "ad_account", entity_id: adAccountId, details: {} });
  revalidatePath("/dashboard/connect");
  redirect("/dashboard/connect?saved=disconnected");
}

export default async function ConnectPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireWorkspace();
  const sp = await searchParams;
  const db0 = supabaseAdmin();
  const [{ data: conns }, { data: adConns }, { data: convs }] = await Promise.all([
    db0.from("channel_connections").select("provider,external_id,display_name,status").eq("workspace_id", ctx.workspace.id),
    db0.from("ad_connections").select("ad_account_id,name,currency,status").eq("workspace_id", ctx.workspace.id),
    db0.from("conversations").select("channel,external_ref,customer_id,created_at").eq("workspace_id", ctx.workspace.id).order("created_at", { ascending: false }).limit(300),
  ]);

  // Resolve customer names for the recent conversations.
  const custIds = Array.from(new Set((convs ?? []).map((c) => c.customer_id).filter(Boolean))) as string[];
  const { data: custs } = custIds.length
    ? await db0.from("customers").select("id,name,phone").in("id", custIds)
    : { data: [] as { id: string; name: string | null; phone: string | null }[] };
  const custMap = new Map((custs ?? []).map((c) => [c.id, c]));

  // Per-channel activity: count and last-seen.
  const countBy: Record<string, number> = {};
  const lastBy: Record<string, string> = {};
  for (const c of convs ?? []) {
    countBy[c.channel] = (countBy[c.channel] ?? 0) + 1;
    if (!lastBy[c.channel]) lastBy[c.channel] = c.created_at; // list is newest-first
  }
  const recent = (convs ?? []).slice(0, 6);

  const appId = process.env.NEXT_PUBLIC_META_APP_ID ?? "";
  const configId = process.env.NEXT_PUBLIC_META_CONFIG_ID ?? "";
  const errors: Record<string, string> = {
    role: "Only owners and admins can manage channels.",
    missing: "Meta did not return the number details. Try again and finish every step in the Meta window.",
    taken: "This WhatsApp number is already connected to another business.",
    meta: "Meta did not accept the connection. Check the app setup, then try again.",
    save: "Couldn't save the change. Try again.",
    cancelled: "The Facebook login was cancelled. Start again when you are ready.",
    state: "That login link expired or was changed. Start again from this page.",
  };
  const saved: Record<string, string> = {
    connected: "WhatsApp connected. Customers can now message this number.",
    paused: "Paused. Your assistant will not read or reply on that channel until you resume it.",
    resumed: "Resumed. Your assistant is replying again.",
    disconnected: "Disconnected. Your assistant has stopped replying there.",
  };

  const wa = conns?.find((c) => c.provider === "whatsapp");
  const meta = (conns ?? []).filter((c) => c.provider === "facebook" || c.provider === "instagram");

  const statusForm = (provider: string, externalId: string, status: string) => (
    <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
      <form action={setChannelStatus}>
        <input type="hidden" name="provider" value={provider} />
        <input type="hidden" name="external_id" value={externalId} />
        <input type="hidden" name="to" value={status === "active" ? "paused" : "active"} />
        <button className="btn btn-ghost btn-sm">{status === "active" ? "Pause replies" : "Resume replies"}</button>
      </form>
      <form action={disconnectChannel}>
        <input type="hidden" name="provider" value={provider} />
        <input type="hidden" name="external_id" value={externalId} />
        <button className="btn btn-ghost btn-sm" style={{ color: "var(--bad, #b00)" }}>Disconnect</button>
      </form>
    </div>
  );

  return (
    <>
      <div className="page-head"><div><h1>Channels</h1><p>Connect WhatsApp, Facebook and Instagram, see what your assistant is doing on each, and stay in control — pause, resume or disconnect any channel with one click.</p></div></div>
      {sp.saved && saved[sp.saved] && <div className="notice notice-ok" role="status">{saved[sp.saved]}</div>}
      {sp.error && <div className="notice notice-bad" role="alert">{errors[sp.error] ?? "Something went wrong."}</div>}
      {sp.saved === "facebook" && <div className="notice notice-ok" role="status">
        Connected {sp.pages ?? 0} Facebook Page{sp.pages === "1" ? "" : "s"}, {sp.ig ?? 0} Instagram account{sp.ig === "1" ? "" : "s"}{Number(sp.ads) > 0 ? `, and ${sp.ads} ad account${sp.ads === "1" ? "" : "s"}` : ""}.
        {Number(sp.skipped) > 0 ? ` ${sp.skipped} skipped: already connected to another business, or Meta did not allow it.` : ""}
      </div>}

      <section className="panel">
        <h2>What your assistant does — and what needs your yes</h2>
        <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--ink-70)", fontSize: 14, lineHeight: 1.7 }}>
          <li><b>Replies to customers</b> on every connected channel, from your catalogue, 24/7.</li>
          <li><b>Quotes prices and takes orders</b>, including bank-transfer orders with a countdown and receipt upload.</li>
          <li><b>Never approves a payment on its own.</b> Every receipt gets an instant &ldquo;received&rdquo; reply, then waits for <b>you</b> to confirm it in <a href="/dashboard/payments">Payments to check</a>.</li>
          <li><b>Only replies inside chats the customer starts.</b> It does not message people first.</li>
          <li><b>Ads stay paused</b> when created — nothing spends until you switch a campaign on yourself.</li>
          <li><b>You stay in control:</b> pause, resume or disconnect any channel below at any time.</li>
        </ul>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>WhatsApp</h2>
        <p style={{ color: "var(--ink-70)", fontSize: 14 }}>{CHANNEL_DOES.whatsapp}</p>
        {wa ? (
          <div style={{ border: "1px solid var(--line, #e5e5e5)", borderRadius: 10, padding: 14, marginTop: 10 }}>
            <div><b>{wa.display_name ?? `Number ${wa.external_id}`}</b> {wa.status === "active" ? "· replying" : "· paused"}</div>
            <div style={{ color: "var(--ink-70)", fontSize: 13, marginTop: 4 }}>{countBy.whatsapp ?? 0} conversation{(countBy.whatsapp ?? 0) === 1 ? "" : "s"} · last {rel(lastBy.whatsapp ?? null)}</div>
            {statusForm("whatsapp", wa.external_id, wa.status)}
          </div>
        ) : <p style={{ color: "var(--ink-70)" }}>Not connected yet.</p>}
        {!wa && (appId && configId
          ? <div style={{ marginTop: 10 }}><ConnectWhatsApp appId={appId} configId={configId} action={connectWhatsApp} /></div>
          : <p style={{ color: "var(--ink-70)" }}>WhatsApp Embedded Signup isn&rsquo;t set up on the server yet (needs the WhatsApp configuration ID).</p>)}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Facebook &amp; Instagram</h2>
        <p style={{ color: "var(--ink-70)", fontSize: 14 }}>Log in with Facebook, choose the Page and Instagram account, and your assistant answers their DMs.</p>
        <p><a href="/api/meta/facebook/start" className="btn btn-lime btn-sm">{meta.length ? "Connect another" : "Connect Facebook & Instagram"}</a></p>
        {meta.length === 0
          ? <p style={{ color: "var(--ink-70)", fontSize: 14 }}>Nothing connected yet.</p>
          : <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              {meta.map((c) => (
                <div key={`${c.provider}-${c.external_id}`} style={{ border: "1px solid var(--line, #e5e5e5)", borderRadius: 10, padding: 14 }}>
                  <div><b>{CHANNEL_LABEL[c.provider]}: {c.display_name ?? c.external_id}</b> {c.status === "active" ? "· replying" : "· paused"}</div>
                  <div style={{ color: "var(--ink-70)", fontSize: 13, marginTop: 4 }}>{countBy[c.provider] ?? 0} conversation{(countBy[c.provider] ?? 0) === 1 ? "" : "s"} · last {rel(lastBy[c.provider] ?? null)}</div>
                  {statusForm(c.provider, c.external_id, c.status)}
                </div>
              ))}
            </div>}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Who your assistant is talking to</h2>
        {recent.length === 0
          ? <p style={{ color: "var(--ink-70)", fontSize: 14 }}>No conversations yet. Once customers message a connected channel, the latest ones show here.</p>
          : <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
              {recent.map((c, i) => {
                const cust = c.customer_id ? custMap.get(c.customer_id) : undefined;
                return <li key={i}>{who(c.channel, c.external_ref, cust?.name ?? null, cust?.phone ?? null)} <span style={{ color: "var(--ink-70)", fontSize: 13 }}>· {CHANNEL_LABEL[c.channel] ?? c.channel} · {rel(c.created_at)}</span></li>;
              })}
            </ul>}
        <p style={{ marginTop: 10 }}><a href="/dashboard/orders" className="btn btn-ghost btn-sm">See orders</a></p>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Ads</h2>
        <p style={{ color: "var(--ink-70)", fontSize: 14 }}>Run Facebook and Instagram ads that send people straight into a chat with your assistant. Campaigns are created paused — nothing spends until you switch them on.</p>
        {(adConns ?? []).length === 0
          ? <p style={{ color: "var(--ink-70)", fontSize: 14 }}>No ad account connected yet. Use <b>Connect Facebook &amp; Instagram</b> above and grant ads access when Facebook asks.</p>
          : <>
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {(adConns ?? []).map((a) => (
                  <div key={a.ad_account_id} style={{ border: "1px solid var(--line, #e5e5e5)", borderRadius: 10, padding: 14 }}>
                    <div><b>{a.name ?? a.ad_account_id}</b> {a.currency ? `(${a.currency})` : ""} {a.status === "active" ? "· ready" : "· paused"}</div>
                    <form action={disconnectAd} style={{ marginTop: 10 }}>
                      <input type="hidden" name="ad_account_id" value={a.ad_account_id} />
                      <button className="btn btn-ghost btn-sm" style={{ color: "var(--bad, #b00)" }}>Disconnect ad account</button>
                    </form>
                  </div>
                ))}
              </div>
              <p style={{ marginTop: 12 }}><a href="/dashboard/ads" className="btn btn-lime btn-sm">Go to Ads</a></p>
            </>}
      </section>
    </>
  );
}
