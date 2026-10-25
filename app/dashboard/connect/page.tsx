import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace, canManage } from "@/lib/workspace";
import { supabaseAdmin } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";
import { exchangeEmbeddedSignupCode, subscribeWaba, phoneNumberInfo } from "@/lib/meta";
import ConnectWhatsApp from "./ConnectWhatsApp";

export const metadata = { title: "Connect with Meta" };

async function connectWhatsApp(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/connect?error=role");
  const code = String(formData.get("code") ?? "").trim();
  const wabaId = String(formData.get("waba_id") ?? "").replace(/\D/g, "");
  const phoneId = String(formData.get("phone_number_id") ?? "").replace(/\D/g, "");
  if (!code || !phoneId) redirect("/dashboard/connect?error=missing");

  const db = supabaseAdmin();
  // One business per number. Refuse rather than move someone else's connection.
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

async function pauseWhatsApp() {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/connect?error=role");
  await supabaseAdmin().from("channel_connections").update({ status: "paused" })
    .eq("workspace_id", ctx.workspace.id).eq("provider", "whatsapp");
  revalidatePath("/dashboard/connect");
  redirect("/dashboard/connect?saved=paused");
}

export default async function ConnectPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireWorkspace();
  const sp = await searchParams;
  const { data: conns } = await supabaseAdmin().from("channel_connections")
    .select("provider,external_id,display_name,status").eq("workspace_id", ctx.workspace.id);
  const appId = process.env.NEXT_PUBLIC_META_APP_ID ?? "";
  const configId = process.env.NEXT_PUBLIC_META_CONFIG_ID ?? "";
  const errors: Record<string, string> = {
    role: "Only owners and admins can connect channels.",
    missing: "Meta did not return the number details. Try again and finish every step in the Meta window.",
    taken: "This WhatsApp number is already connected to another business.",
    meta: "Meta did not accept the connection. Check the app setup, then try again.",
    save: "Couldn't save the connection. Try again.",
  };
  const saved: Record<string, string> = { connected: "WhatsApp connected. Customers can now message this number.", paused: "WhatsApp paused. Customers will not get replies until you connect again." };
  const wa = conns?.find((c) => c.provider === "whatsapp");

  return (
    <>
      <div className="page-head"><div><h1>Connect with Meta</h1><p>Link your WhatsApp Business number, and later your Instagram and Facebook pages, in a few clicks. Your assistant then answers customers there, 24/7.</p></div></div>
      {sp.saved && saved[sp.saved] && <div className="notice notice-ok" role="status">{saved[sp.saved]}</div>}
      {sp.error && <div className="notice notice-bad" role="alert">{errors[sp.error] ?? "Something went wrong."}</div>}

      <section className="panel">
        <h2>WhatsApp</h2>
        {wa?.status === "active" ? <p>Connected{wa.display_name ? <>: <b>{wa.display_name}</b></> : null} (number ID <span className="mono">{wa.external_id}</span>).</p>
          : wa ? <p>Paused. Connect again to turn replies back on.</p>
          : <p>Not connected yet.</p>}
        {appId && configId
          ? <ConnectWhatsApp appId={appId} configId={configId} action={connectWhatsApp} />
          : <p style={{ color: "var(--ink-70)" }}>Meta connection is not set up on this server yet. The developer needs to add the Meta app settings (see README → Meta setup).</p>}
        {wa?.status === "active" && (
          <form action={pauseWhatsApp} style={{ marginTop: 12 }}><button className="btn btn-ghost btn-sm">Pause WhatsApp replies</button></form>
        )}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Instagram and Facebook</h2>
        <p style={{ color: "var(--ink-70)", fontSize: 14 }}>Coming next. These use the same Meta app and need Meta to approve the messaging permissions first.</p>
      </section>
    </>
  );
}
