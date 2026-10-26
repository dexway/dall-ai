import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace, canManage } from "@/lib/workspace";
import { supabaseAdmin } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";
import { exchangeEmbeddedSignupCode, subscribeWaba, phoneNumberInfo } from "@/lib/meta";
import ConnectWhatsApp from "./ConnectWhatsApp";

export const metadata = { title: "Channels" };

type Avail = "live" | "approval" | "soon" | "always";
type ChannelDef = {
  key: string; provider: string | null; convChannel: string | null; label: string; color: string; glyph: string;
  headline: string; pitch: string; learn: string; avail: Avail;
};

const CHANNELS: ChannelDef[] = [
  { key: "whatsapp", provider: "whatsapp", convChannel: "whatsapp", label: "WhatsApp", color: "#25D366", glyph: "W",
    headline: "WhatsApp for your business", pitch: "Your assistant answers every WhatsApp message to your business number — quotes from your catalogue, takes the order and collects payment, 24/7.",
    learn: "https://business.whatsapp.com/products/business-platform", avail: "live" },
  { key: "messenger", provider: "facebook", convChannel: "facebook", label: "Messenger", color: "#0866FF", glyph: "M",
    headline: "Messenger for your Facebook Page", pitch: "Customers who message your Facebook Page get instant, accurate answers and can order without leaving the chat.",
    learn: "https://developers.facebook.com/docs/messenger-platform", avail: "live" },
  { key: "instagram", provider: "instagram", convChannel: "instagram", label: "Instagram", color: "#E1306C", glyph: "I",
    headline: "Instagram DMs that sell", pitch: "Turn Instagram DMs into orders. Your assistant replies to every DM with real prices and a checkout. Replies go live once Meta approves the app.",
    learn: "https://developers.facebook.com/docs/instagram-platform", avail: "approval" },
  { key: "tiktok", provider: null, convChannel: null, label: "TikTok", color: "#111111", glyph: "T",
    headline: "TikTok DMs", pitch: "Answer TikTok messages and turn viewers into buyers. We're building this next.",
    learn: "https://developers.tiktok.com/", avail: "soon" },
  { key: "web", provider: null, convChannel: "web", label: "Website chat", color: "#C8EE72", glyph: "◎",
    headline: "Your own chat page", pitch: "A ready chat link for your bio, flyers and website. Always on — no setup needed.",
    learn: "", avail: "always" },
  { key: "voice", provider: null, convChannel: null, label: "Calls & SMS", color: "#D77A5C", glyph: "☎",
    headline: "Phone calls and SMS", pitch: "Your assistant answers calls and makes follow-up calls with a Nigerian number. Coming soon.",
    learn: "", avail: "soon" },
];

function rel(iso: string | null | undefined): string {
  if (!iso) return "no activity yet";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

const STATUS: Record<string, { label: string; color: string }> = {
  active: { label: "Replying", color: "#2E9E5B" },
  paused: { label: "Paused", color: "#C98A1B" },
  needs_reconnect: { label: "Lost connection", color: "#C0392B" },
  none: { label: "Not connected", color: "#9AA19F" },
};

const back = (c: string, q: string) => redirect(`/dashboard/connect?c=${encodeURIComponent(c)}&${q}`);

async function connectWhatsApp(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) back("whatsapp", "error=role");
  const code = String(formData.get("code") ?? "").trim();
  const wabaId = String(formData.get("waba_id") ?? "").replace(/\D/g, "");
  const phoneId = String(formData.get("phone_number_id") ?? "").replace(/\D/g, "");
  if (!code || !phoneId) back("whatsapp", "error=missing");

  const db = supabaseAdmin();
  const { data: other } = await db.from("channel_connections").select("workspace_id")
    .eq("provider", "whatsapp").eq("external_id", phoneId).maybeSingle();
  if (other && other.workspace_id !== ctx.workspace.id) back("whatsapp", "error=taken");

  let token = "";
  let label: string | null = null;
  try {
    token = await exchangeEmbeddedSignupCode(code);
    if (wabaId) await subscribeWaba(token, wabaId);
    const info = await phoneNumberInfo(token, phoneId);
    label = [info.verified_name, info.display_phone_number].filter(Boolean).join(" · ") || null;
  } catch (e) {
    console.error("[meta] whatsapp connect failed", (e as Error).message);
    back("whatsapp", "error=meta");
  }

  const { error } = await db.from("channel_connections").upsert({
    workspace_id: ctx.workspace.id, provider: "whatsapp", external_id: phoneId, display_name: label,
    access_token_enc: encryptSecret(token), status: "active", last_error: null,
  }, { onConflict: "provider,external_id" });
  if (error) back("whatsapp", "error=save");
  await db.from("financial_audit_logs").insert({ workspace_id: ctx.workspace.id, actor_id: ctx.user.id, action: "channel.whatsapp_connected", entity: "workspace", entity_id: ctx.workspace.id, details: { phone_number_id: phoneId } });
  revalidatePath("/dashboard/connect");
  back("whatsapp", "saved=connected");
}

async function setChannelStatus(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  const c = String(formData.get("back") ?? "");
  if (!canManage(ctx)) back(c, "error=role");
  const provider = String(formData.get("provider") ?? "");
  const externalId = String(formData.get("external_id") ?? "");
  const to = String(formData.get("to") ?? "") === "paused" ? "paused" : "active";
  await supabaseAdmin().from("channel_connections").update({ status: to })
    .eq("workspace_id", ctx.workspace.id).eq("provider", provider).eq("external_id", externalId);
  await supabaseAdmin().from("financial_audit_logs").insert({ workspace_id: ctx.workspace.id, actor_id: ctx.user.id, action: `channel.${to === "paused" ? "paused" : "resumed"}`, entity: "channel", entity_id: externalId, details: { provider } });
  revalidatePath("/dashboard/connect");
  back(c, `saved=${to === "paused" ? "paused" : "resumed"}`);
}

async function disconnectChannel(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  const c = String(formData.get("back") ?? "");
  if (!canManage(ctx)) back(c, "error=role");
  const provider = String(formData.get("provider") ?? "");
  const externalId = String(formData.get("external_id") ?? "");
  await supabaseAdmin().from("channel_connections").delete()
    .eq("workspace_id", ctx.workspace.id).eq("provider", provider).eq("external_id", externalId);
  await supabaseAdmin().from("financial_audit_logs").insert({ workspace_id: ctx.workspace.id, actor_id: ctx.user.id, action: "channel.disconnected", entity: "channel", entity_id: externalId, details: { provider } });
  revalidatePath("/dashboard/connect");
  back(c, "saved=disconnected");
}

async function disconnectAd(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) back("integrations", "error=role");
  const adAccountId = String(formData.get("ad_account_id") ?? "");
  await supabaseAdmin().from("ad_connections").delete().eq("workspace_id", ctx.workspace.id).eq("ad_account_id", adAccountId);
  await supabaseAdmin().from("financial_audit_logs").insert({ workspace_id: ctx.workspace.id, actor_id: ctx.user.id, action: "ads.disconnected", entity: "ad_account", entity_id: adAccountId, details: {} });
  revalidatePath("/dashboard/connect");
  back("integrations", "saved=disconnected");
}

// ---- UI pieces ----

function Icon({ ch, size = 28 }: { ch: ChannelDef; size?: number }) {
  return <span style={{ width: size, height: size, borderRadius: size / 3.2, background: ch.color, color: ch.key === "web" ? "#14231F" : "#fff", display: "inline-grid", placeItems: "center", fontWeight: 800, fontSize: size * 0.45, flex: "none" }}>{ch.glyph}</span>;
}

function Dot({ status }: { status: string }) {
  return <span title={STATUS[status]?.label} style={{ width: 8, height: 8, borderRadius: 99, background: STATUS[status]?.color ?? "#9AA19F", display: "inline-block", flex: "none" }} />;
}

function Badge({ text, tone = "grey" }: { text: string; tone?: "grey" | "blue" | "green" | "amber" | "red" }) {
  const c = { grey: ["#EEF0EE", "#5B6461"], blue: ["#E6EEFF", "#1F4FD1"], green: ["#E3F5EA", "#1E7A45"], amber: ["#FBF0DC", "#8A5A0B"], red: ["#FBE4E1", "#A52A1E"] }[tone];
  return <span style={{ background: c[0], color: c[1], fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", padding: "3px 7px", borderRadius: 6 }}>{text}</span>;
}

// One settings row: label | actions | explanation (the ManyChat-style row).
function Row({ label, children, help }: { label: React.ReactNode; children: React.ReactNode; help: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(140px,1fr) minmax(200px,1.3fr) minmax(200px,1.4fr)", gap: 20, padding: "16px 18px", borderTop: "1px solid var(--line, #e7e7e3)", alignItems: "start" }}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>{children}</div>
      <div style={{ color: "var(--ink-70)", fontSize: 13, lineHeight: 1.5 }}>{help}</div>
    </div>
  );
}

export default async function ConnectPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireWorkspace();
  const sp = await searchParams;
  const db = supabaseAdmin();
  const [{ data: conns }, { data: adConns }, { data: convs }, { data: agent }] = await Promise.all([
    db.from("channel_connections").select("provider,external_id,display_name,status,last_error,last_error_at").eq("workspace_id", ctx.workspace.id),
    db.from("ad_connections").select("ad_account_id,name,currency,status").eq("workspace_id", ctx.workspace.id),
    db.from("conversations").select("channel,external_ref,customer_id,created_at").eq("workspace_id", ctx.workspace.id).order("created_at", { ascending: false }).limit(300),
    db.from("agents").select("name,greeting").eq("workspace_id", ctx.workspace.id).order("created_at").limit(1).maybeSingle(),
  ]);

  const custIds = Array.from(new Set((convs ?? []).map((c) => c.customer_id).filter(Boolean))) as string[];
  const { data: custs } = custIds.length ? await db.from("customers").select("id,name,phone").in("id", custIds) : { data: [] as { id: string; name: string | null; phone: string | null }[] };
  const custMap = new Map((custs ?? []).map((c) => [c.id, c]));

  const countBy: Record<string, number> = {};
  const lastBy: Record<string, string> = {};
  for (const c of convs ?? []) { countBy[c.channel] = (countBy[c.channel] ?? 0) + 1; if (!lastBy[c.channel]) lastBy[c.channel] = c.created_at; }

  const connsFor = (ch: ChannelDef) => (conns ?? []).filter((c) => ch.provider && c.provider === ch.provider);
  const statusFor = (ch: ChannelDef): string => {
    if (ch.avail === "always") return "active";
    const list = connsFor(ch);
    if (!list.length) return "none";
    if (list.some((c) => c.status === "needs_reconnect")) return "needs_reconnect";
    if (list.some((c) => c.status === "active")) return "active";
    return "paused";
  };
  const lost = CHANNELS.filter((ch) => statusFor(ch) === "needs_reconnect");

  const selected = sp.c ?? "overview";
  const ch = CHANNELS.find((x) => x.key === selected);
  const appId = process.env.NEXT_PUBLIC_META_APP_ID ?? "";
  const configId = process.env.NEXT_PUBLIC_META_CONFIG_ID ?? "";
  const chatUrl = `/chat/${ctx.workspace.slug}`;

  const errors: Record<string, string> = {
    role: "Only owners and admins can manage channels.",
    missing: "Meta did not return the number details. Try again and finish every step in the Meta window.",
    taken: "This account is already connected to another business.",
    meta: "Meta did not accept the connection. Check the app setup, then try again.",
    save: "Couldn't save the change. Try again.",
    cancelled: "The Facebook login was cancelled. Start again when you're ready.",
    state: "That login link expired or was changed. Start again from this page.",
  };
  const saved: Record<string, string> = {
    connected: "Connected. Customers can message this channel now.",
    paused: "Paused. Your assistant won't read or reply here until you resume.",
    resumed: "Resumed. Your assistant is replying again.",
    disconnected: "Disconnected. Your assistant has stopped replying there.",
  };

  const NavItem = ({ k, label, icon, status }: { k: string; label: string; icon?: React.ReactNode; status?: string }) => (
    <Link href={`/dashboard/connect?c=${k}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, textDecoration: "none", color: "inherit", fontSize: 14, background: selected === k ? "var(--lime-soft, #EEF8D8)" : "transparent", fontWeight: selected === k ? 600 : 400 }}>
      {icon}<span style={{ flex: 1 }}>{label}</span>{status && <Dot status={status} />}
    </Link>
  );

  // Rows for one connected account on a messaging channel.
  const accountBlock = (def: ChannelDef, c: { provider: string; external_id: string; display_name: string | null; status: string; last_error: string | null }) => {
    const st = STATUS[c.status] ?? STATUS.active;
    const recent = (convs ?? []).filter((v) => v.channel === def.convChannel).slice(0, 3);
    const isMeta = def.provider === "facebook" || def.provider === "instagram";
    return (
      <div key={`${c.provider}-${c.external_id}`} className="panel" style={{ padding: 0, overflow: "hidden", marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px" }}>
          <Icon ch={def} size={44} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{c.display_name ?? c.external_id}</div>
            <div style={{ fontSize: 12, color: "var(--ink-70)" }}>{def.label} · ID {c.external_id}</div>
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: st.color }}><Dot status={c.status} />{st.label}</span>
        </div>

        {c.status === "needs_reconnect" && (
          <div style={{ margin: "0 18px 14px", background: "#FBE4E1", color: "#7A2017", borderRadius: 8, padding: "10px 12px", fontSize: 13 }}>
            Meta stopped accepting replies for this account — usually a changed password, removed permission or expired access. Refresh permissions to fix it.
          </div>
        )}

        <Row label="Replies" help="While paused, your assistant reads nothing and sends nothing on this account. Customers won't get replies.">
          <form action={setChannelStatus}>
            <input type="hidden" name="back" value={def.key} /><input type="hidden" name="provider" value={c.provider} /><input type="hidden" name="external_id" value={c.external_id} />
            <input type="hidden" name="to" value={c.status === "active" ? "paused" : "active"} />
            <button className="btn btn-line btn-sm">{c.status === "active" ? "Pause replies" : "Resume replies"}</button>
          </form>
        </Row>
        <Row label="Greeting & personality" help={<>New chats open with: <i>&ldquo;{agent?.greeting ?? "Hello! How can I help you today?"}&rdquo;</i>. Change the voice, knowledge and greeting in the studio.</>}>
          <Link href="/dashboard/agent" className="btn btn-line btn-sm">Edit in Assistant studio</Link>
        </Row>
        <Row label="Activity" help="Conversations your assistant has handled on this channel.">
          <span style={{ fontSize: 14 }}><b>{countBy[def.convChannel ?? ""] ?? 0}</b> conversations · last {rel(lastBy[def.convChannel ?? ""])}</span>
        </Row>
        <Row label="Who it's talking to" help="The most recent customers on this channel. Orders and payments appear under Orders.">
          {recent.length === 0 ? <span style={{ fontSize: 13, color: "var(--ink-70)" }}>No conversations yet.</span>
            : <div style={{ display: "grid", gap: 4, fontSize: 13 }}>{recent.map((v, i) => {
                const cu = v.customer_id ? custMap.get(v.customer_id) : undefined;
                const who = cu?.name ?? (def.key === "whatsapp" ? (cu?.phone ?? `+${v.external_ref ?? ""}`) : `Customer ${(v.external_ref ?? "").slice(-6)}`);
                return <span key={i}>{who} <span style={{ color: "var(--ink-70)" }}>· {rel(v.created_at)}</span></span>;
              })}</div>}
        </Row>
        {isMeta && (
          <Row label="Refresh permissions" help={def.provider === "instagram"
            ? "Your Instagram is connected through the Facebook Page it's linked to, so refreshing opens a Facebook login — that's expected. Pick the same Page and keep every permission ticked."
            : "Meta can unexpectedly drop a connection. If replies stop sending or settings won't save, refresh permissions first — it takes one Facebook login."}>
            <a href="/api/meta/facebook/start" className="btn btn-line btn-sm">{def.provider === "instagram" ? "Refresh via Facebook" : "Refresh permissions"}</a>
          </Row>
        )}
        <Row label="Disconnect" help="Removes the saved access so your assistant stops replying here at once. You can reconnect any time.">
          <form action={disconnectChannel}>
            <input type="hidden" name="back" value={def.key} /><input type="hidden" name="provider" value={c.provider} /><input type="hidden" name="external_id" value={c.external_id} />
            <button className="btn btn-ghost btn-sm" style={{ color: "var(--bad, #b00)" }}>Disconnect</button>
          </form>
        </Row>
      </div>
    );
  };

  // The "not connected" hero for a channel.
  const connectHero = (def: ChannelDef) => (
    <div className="panel" style={{ textAlign: "center", padding: "48px 24px" }}>
      <div style={{ display: "grid", placeItems: "center", width: 120, height: 120, borderRadius: 36, background: `${def.color}22`, margin: "0 auto 18px" }}>
        <Icon ch={def} size={72} />
      </div>
      <h2 style={{ margin: "0 0 8px" }}>{def.headline}</h2>
      <p style={{ color: "var(--ink-70)", maxWidth: 480, margin: "0 auto 6px", lineHeight: 1.55 }}>{def.pitch}</p>
      {def.learn && <p style={{ margin: "0 0 18px" }}><a href={def.learn} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>Learn more</a></p>}
      {def.avail === "soon" ? <Badge text="Coming soon" tone="grey" />
        : def.key === "whatsapp" ? (appId && configId
            ? <div style={{ display: "inline-block" }}><ConnectWhatsApp appId={appId} configId={configId} action={connectWhatsApp} /></div>
            : <div style={{ display: "grid", gap: 8, justifyItems: "center" }}>
                <Link href="/dashboard/settings" className="btn btn-lime">Connect with a number ID</Link>
                <small style={{ color: "var(--ink-70)" }}>One-click WhatsApp signup turns on once Meta confirms Dall AI as a Tech Provider.</small>
              </div>)
        : <a href="/api/meta/facebook/start" className="btn btn-lime">Connect with Facebook</a>}
    </div>
  );

  return (
    <>
      {lost.length > 0 && (
        <div style={{ background: "#2A1714", color: "#FDE8E4", borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}>
          <span>⚠</span>
          <span style={{ flex: 1 }}>{lost.map((l) => l.label).join(" and ")} lost connection with Meta. Customers there aren&rsquo;t getting replies.</span>
          <a href="/api/meta/facebook/start" style={{ color: "#C8EE72", fontWeight: 700 }}>Refresh permissions</a>
        </div>
      )}
      <div className="page-head"><div><h1>Channels</h1><p>Connect where your customers already talk. Your assistant replies, sells and checks payments on every channel — and you stay in control of each one.</p></div></div>
      {sp.saved && saved[sp.saved] && <div className="notice notice-ok" role="status">{saved[sp.saved]}</div>}
      {sp.error && <div className="notice notice-bad" role="alert">{errors[sp.error] ?? "Something went wrong."}</div>}
      {sp.saved === "facebook" && <div className="notice notice-ok" role="status">
        Connected {sp.pages ?? 0} Facebook Page{sp.pages === "1" ? "" : "s"}, {sp.ig ?? 0} Instagram account{sp.ig === "1" ? "" : "s"}{Number(sp.ads) > 0 ? ` and ${sp.ads} ad account${sp.ads === "1" ? "" : "s"}` : ""}.
        {Number(sp.skipped) > 0 ? ` ${sp.skipped} skipped: already connected to another business, or Meta didn't allow it.` : ""}
      </div>}

      <div style={{ display: "grid", gridTemplateColumns: "210px minmax(0,1fr)", gap: 20, alignItems: "start" }}>
        <nav className="panel" style={{ padding: 10, position: "sticky", top: 16 }}>
          <NavItem k="overview" label="Overview" icon={<span style={{ width: 22, textAlign: "center" }}>⌂</span>} />
          <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--ink-50, #8A918E)", margin: "12px 10px 4px" }}>Channels</div>
          {CHANNELS.map((c) => <NavItem key={c.key} k={c.key} label={c.label} icon={<Icon ch={c} size={22} />} status={c.avail === "soon" ? undefined : statusFor(c)} />)}
          <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--ink-50, #8A918E)", margin: "12px 10px 4px" }}>Extensions</div>
          <NavItem k="integrations" label="Integrations" icon={<span style={{ width: 22, textAlign: "center" }}>⧉</span>} />
        </nav>

        <div>
          {selected === "overview" && (
            <>
              <section className="panel" style={{ textAlign: "center", padding: "28px 20px" }}>
                <div style={{ fontSize: 12, color: "var(--ink-70)" }}>Welcome to your channels</div>
                <h2 style={{ margin: "6px 0 18px", fontSize: 26 }}>Meet your 24/7 sales sidekick</h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14, textAlign: "left" }}>
                  {[
                    { t: "AI Replies", d: `${agent?.name ?? "Your assistant"} answers every DM and WhatsApp from your catalogue and knowledge, day and night.`, b: <Badge text="Live" tone="green" />, demo: ["How much is the party pack?", "₦85,000 — serves 40. Want me to book Saturday? 🎉"] },
                    { t: "AI Orders & Payments", d: "Quotes the exact total, sends your bank details with a countdown, and flags fake receipts. You confirm every payment.", b: <Badge text="Live" tone="green" />, demo: ["Sent ✅ here's my receipt", "Got it! The team is confirming now 🙏"] },
                    { t: "AI Comments", d: "Replies to comments on your posts and moves interested people into DMs to buy.", b: <Badge text="Coming soon" />, demo: ["Price pls 😍", "Sent you a DM with prices! 💬"] },
                  ].map((x) => (
                    <div key={x.t} style={{ border: "1px solid var(--line,#e7e7e3)", borderRadius: 14, overflow: "hidden", background: "#fff" }}>
                      <div style={{ background: "#14231F", padding: 16, display: "grid", gap: 8, minHeight: 120 }}>
                        <span style={{ justifySelf: "start", background: "#2C3B37", color: "#E9EEE9", borderRadius: 14, padding: "7px 11px", fontSize: 12.5, maxWidth: "85%" }}>{x.demo[0]}</span>
                        <span style={{ justifySelf: "end", background: "#C8EE72", color: "#14231F", borderRadius: 14, padding: "7px 11px", fontSize: 12.5, maxWidth: "85%" }}>{x.demo[1]}</span>
                      </div>
                      <div style={{ padding: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}><b>{x.t}</b>{x.b}</div>
                        <p style={{ fontSize: 13, color: "var(--ink-70)", margin: "6px 0 0", lineHeight: 1.5 }}>{x.d}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="panel" style={{ marginTop: 16 }}>
                <h2>Your channels</h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12, marginTop: 10 }}>
                  {CHANNELS.map((c) => {
                    const st = c.avail === "soon" ? null : statusFor(c);
                    return (
                      <Link key={c.key} href={`/dashboard/connect?c=${c.key}`} style={{ border: "1px solid var(--line,#e7e7e3)", borderRadius: 12, padding: 14, display: "flex", gap: 12, alignItems: "center", textDecoration: "none", color: "inherit", background: "#fff" }}>
                        <Icon ch={c} size={36} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600 }}>{c.label}</div>
                          <div style={{ fontSize: 12, color: st ? STATUS[st].color : "var(--ink-70)" }}>{st ? STATUS[st].label : "Coming soon"}</div>
                        </div>
                        <span style={{ color: "var(--ink-50,#8A918E)" }}>›</span>
                      </Link>
                    );
                  })}
                </div>
              </section>

              <section className="panel" style={{ marginTop: 16 }}>
                <h2>What your assistant does — and what needs your yes</h2>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--ink-70)", fontSize: 14, lineHeight: 1.7 }}>
                  <li>Replies on every connected channel, from your catalogue and knowledge, 24/7.</li>
                  <li><b>Never approves a payment itself</b> — receipts wait for you in <Link href="/dashboard/payments">Payments to check</Link>.</li>
                  <li>Only replies inside chats the customer starts. Ads stay paused until you switch them on.</li>
                  <li>Pause, resume or disconnect any channel at any time.</li>
                </ul>
              </section>
            </>
          )}

          {ch && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <Icon ch={ch} size={34} />
                <h2 style={{ margin: 0 }}>{ch.label}</h2>
                {ch.avail === "approval" && <Badge text="Needs Meta approval" tone="amber" />}
                {ch.avail === "soon" && <Badge text="Coming soon" />}
              </div>

              {ch.key === "web" ? (
                <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 18 }}>
                    <Icon ch={ch} size={44} />
                    <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 17 }}>Your chat page</div><div style={{ fontSize: 12, color: "var(--ink-70)" }}>dall-ai.vercel.app{chatUrl}</div></div>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: STATUS.active.color }}><Dot status="active" />Always on</span>
                  </div>
                  <Row label="Chat link" help="Put this in your Instagram bio, on flyers, WhatsApp status and your website.">
                    <a href={chatUrl} target="_blank" rel="noreferrer" className="btn btn-line btn-sm">Open chat page ↗</a>
                  </Row>
                  <Row label="Activity" help="Conversations from your chat page.">
                    <span style={{ fontSize: 14 }}><b>{countBy.web ?? 0}</b> conversations · last {rel(lastBy.web)}</span>
                  </Row>
                  <Row label="Launch kit" help="Ready-to-post slides with your chat link built in.">
                    <Link href="/dashboard/agent" className="btn btn-line btn-sm">Open launch kit</Link>
                  </Row>
                </div>
              ) : connsFor(ch).length === 0 ? connectHero(ch) : (
                <>
                  {connsFor(ch).map((c) => accountBlock(ch, c))}
                  {ch.provider !== "whatsapp" && (
                    <div className="panel" style={{ marginTop: 14, padding: 0 }}>
                      <Row label="Add another account" help="Connected more Pages since? Log in again and pick them — existing connections stay as they are.">
                        <a href="/api/meta/facebook/start" className="btn btn-line btn-sm">Connect another</a>
                      </Row>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {selected === "integrations" && (
            <>
              <h2 style={{ marginTop: 0 }}>Integrations</h2>
              <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
                <Row label={<>Meta ad accounts {(adConns ?? []).length > 0 && <Badge text="Connected" tone="green" />}</>} help="Run click-to-chat ads from the Ads page. Connected through the same Facebook login as your Page.">
                  {(adConns ?? []).length === 0 ? <a href="/api/meta/facebook/start" className="btn btn-line btn-sm">Connect ad account</a>
                    : <div style={{ display: "grid", gap: 6, width: "100%" }}>
                        {(adConns ?? []).map((a) => (
                          <form key={a.ad_account_id} action={disconnectAd} style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 13 }}>{a.name ?? a.ad_account_id} {a.currency ? `(${a.currency})` : ""}</span>
                            <input type="hidden" name="ad_account_id" value={a.ad_account_id} />
                            <button className="btn btn-ghost btn-sm" style={{ color: "var(--bad,#b00)" }}>Disconnect</button>
                          </form>
                        ))}
                        <Link href="/dashboard/ads" className="btn btn-line btn-sm" style={{ justifySelf: "start" }}>Go to Ads</Link>
                      </div>}
                </Row>
                <Row label="Bank transfer & receipts" help="Your bank details, payment countdown and early-payment bonus. Receipts land in Payments to check.">
                  <Link href="/dashboard/settings" className="btn btn-line btn-sm">Payment settings</Link>
                </Row>
                <Row label={<>Google Sheets <Badge text="Soon" /></>} help="Send every new order and customer to a Google Sheet automatically.">
                  <button className="btn btn-line btn-sm" disabled>Connect</button>
                </Row>
                <Row label={<>Zapier &amp; Make <Badge text="Soon" /></>} help="Connect Dall AI to thousands of apps — CRMs, email tools, delivery services.">
                  <button className="btn btn-line btn-sm" disabled>Connect</button>
                </Row>
                <Row label={<>Meta Conversions API <Badge text="Soon" /></>} help="Tell Meta which ad chats became paid orders, so your ads find more real buyers.">
                  <button className="btn btn-line btn-sm" disabled>Enable</button>
                </Row>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
