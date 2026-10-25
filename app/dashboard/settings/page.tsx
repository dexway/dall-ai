import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace, canManage } from "@/lib/workspace";
import { supabaseAdmin } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";
import { serverEnv } from "@/lib/env";

export const metadata = { title: "Payment settings" };

async function saveBank(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/settings?error=role");
  const acct = String(formData.get("account_number") ?? "").replace(/\D/g, "");
  if (acct && acct.length !== 10) redirect("/dashboard/settings?error=nuban");
  const { error } = await ctx.db.from("business_payment_settings").update({
    bank_name: String(formData.get("bank_name") ?? "").trim() || null,
    account_name: String(formData.get("account_name") ?? "").trim() || null,
    account_number: acct || null,
    transfer_instructions: String(formData.get("transfer_instructions") ?? "").trim() || null,
    payment_deadline_hours: Math.min(168, Math.max(1, Number(formData.get("payment_deadline_hours")) || 24)),
    payment_window_minutes: Math.min(1440, Math.max(5, Number(formData.get("payment_window_minutes")) || 60)),
    updated_at: new Date().toISOString(),
  }).eq("workspace_id", ctx.workspace.id);
  if (error) redirect("/dashboard/settings?error=save");
  revalidatePath("/dashboard/settings");
  redirect("/dashboard/settings?saved=bank");
}

async function savePaystack(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/settings?error=role");
  const secret = String(formData.get("secret") ?? "").trim();
  const pub = String(formData.get("public") ?? "").trim();
  const enable = formData.get("enabled") === "on";
  if (secret && !/^sk_(test|live)_[A-Za-z0-9]{20,}$/.test(secret)) redirect("/dashboard/settings?error=sk");
  if (pub && !/^pk_(test|live)_[A-Za-z0-9]{20,}$/.test(pub)) redirect("/dashboard/settings?error=pk");
  if (secret) {
    // Membership + role were checked above; the secret table is only writable by the server.
    const { error } = await supabaseAdmin().from("business_payment_secrets")
      .upsert({ workspace_id: ctx.workspace.id, paystack_secret_enc: encryptSecret(secret), updated_at: new Date().toISOString() });
    if (error) redirect("/dashboard/settings?error=save");
  }
  await ctx.db.from("business_payment_settings").update({ paystack_enabled: enable, paystack_public_key: pub || null }).eq("workspace_id", ctx.workspace.id);
  await supabaseAdmin().from("financial_audit_logs").insert({ workspace_id: ctx.workspace.id, actor_id: ctx.user.id, action: "settings.paystack", entity: "workspace", entity_id: ctx.workspace.id, details: { enabled: enable, key_changed: Boolean(secret) } });
  revalidatePath("/dashboard/settings");
  redirect("/dashboard/settings?saved=paystack");
}

async function saveWhatsApp(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/settings?error=role");
  const phoneId = String(formData.get("phone_number_id") ?? "").replace(/\D/g, "");
  const token = String(formData.get("access_token") ?? "").trim();
  const name = String(formData.get("display_name") ?? "").trim() || null;
  if (!phoneId) redirect("/dashboard/settings?error=wa_id");
  if (token.length < 20) redirect("/dashboard/settings?error=wa_token");
  const db = supabaseAdmin();
  // A number can belong to one business only. Refuse rather than move someone else's connection.
  const { data: other } = await db.from("channel_connections").select("workspace_id")
    .eq("provider", "whatsapp").eq("external_id", phoneId).maybeSingle();
  if (other && other.workspace_id !== ctx.workspace.id) redirect("/dashboard/settings?error=wa_taken");
  const { error } = await db.from("channel_connections").upsert({
    workspace_id: ctx.workspace.id, provider: "whatsapp", external_id: phoneId, display_name: name,
    access_token_enc: encryptSecret(token), status: "active",
  }, { onConflict: "provider,external_id" });
  if (error) redirect("/dashboard/settings?error=save");
  await db.from("financial_audit_logs").insert({ workspace_id: ctx.workspace.id, actor_id: ctx.user.id, action: "settings.whatsapp", entity: "workspace", entity_id: ctx.workspace.id, details: { phone_number_id: phoneId } });
  revalidatePath("/dashboard/settings");
  redirect("/dashboard/settings?saved=whatsapp");
}

export default async function Settings({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireWorkspace();
  const sp = await searchParams;
  const { data: s } = await ctx.db.from("business_payment_settings").select("*").eq("workspace_id", ctx.workspace.id).single();
  const { data: sec } = await supabaseAdmin().from("business_payment_secrets").select("updated_at").eq("workspace_id", ctx.workspace.id).maybeSingle();
  const webhook = `${serverEnv.siteUrl()}/api/webhooks/paystack/${ctx.workspace.id}`;
  const { data: wa } = await supabaseAdmin().from("channel_connections").select("external_id,display_name,status")
    .eq("workspace_id", ctx.workspace.id).eq("provider", "whatsapp").maybeSingle();
  const waCallback = `${serverEnv.siteUrl()}/api/webhooks/whatsapp`;
  const errors: Record<string, string> = { role: "Only owners and admins can change payment settings.", nuban: "Account numbers in Nigeria have 10 digits.", sk: "That doesn't look like a Paystack secret key (sk_test_… or sk_live_…).", pk: "That doesn't look like a Paystack public key (pk_…).", save: "Couldn't save. Try again.", wa_id: "Enter the Phone number ID from Meta (digits only).", wa_token: "Paste the WhatsApp access token from Meta.", wa_taken: "This WhatsApp number is already connected to another business." };

  return (
    <>
      <div className="page-head"><div><h1>Payment settings</h1><p>Where your customers&apos; money goes. Payments always settle to your own account; {""}
        Dall AI never holds your sales money.</p></div></div>
      {sp.saved && <div className="notice notice-ok" role="status">Saved.</div>}
      {sp.error && <div className="notice notice-bad" role="alert">{errors[sp.error] ?? "Something went wrong."}</div>}

      <div className="two">
        <form action={saveBank} className="panel">
          <h2>Bank transfer</h2>
          <p style={{ color: "var(--ink-70)", fontSize: 14 }}>Your assistant sends these in the chat with the exact amount and order reference, then asks for the transfer screenshot.</p>
          <div className="form-grid">
            <label className="field"><span>Bank</span><input id="bank_name" name="bank_name" className="input" defaultValue={s?.bank_name ?? ""} placeholder="e.g. GTBank, Moniepoint, Opay" /></label>
            <label className="field"><span>Account number</span><input id="account_number" name="account_number" className="input mono" inputMode="numeric" maxLength={10} defaultValue={s?.account_number ?? ""} /></label>
          </div>
          <label className="field"><span>Account name</span><input id="account_name" name="account_name" className="input" defaultValue={s?.account_name ?? ""} /></label>
          <label className="field"><span>Extra instructions</span><textarea id="transfer_instructions" name="transfer_instructions" className="input" defaultValue={s?.transfer_instructions ?? ""} placeholder="Use your order reference as the narration." /></label>
          <label className="field"><span>Chat payment timer (minutes)</span><input id="payment_window_minutes" name="payment_window_minutes" type="number" min={5} max={1440} className="input" defaultValue={s?.payment_window_minutes ?? 60} />
            <small>After your assistant gives your bank details, the customer sees a countdown to pay and send their receipt.</small></label>
          <input type="hidden" name="payment_deadline_hours" value={s?.payment_deadline_hours ?? 24} />
          <div><button className="btn btn-ink">Save bank details</button></div>
        </form>

        <form action={savePaystack} className="panel">
          <h2>Paystack (cards, USSD, bank transfer via Paystack)</h2>
          <p style={{ color: "var(--ink-70)", fontSize: 14 }}>Use the keys from your own Paystack dashboard → Settings → API Keys & Webhooks. Start with test keys.</p>
          <label className="field"><span>Secret key</span><input id="secret" name="secret" type="password" autoComplete="off" className="input mono" placeholder={sec ? "•••••••• saved (enter a new one to replace)" : "sk_test_…"} />
            <small>Encrypted before it&apos;s stored. It is never shown again or sent to the browser.</small></label>
          <label className="field"><span>Public key</span><input id="public" name="public" className="input mono" defaultValue={s?.paystack_public_key ?? ""} placeholder="pk_test_…" /></label>
          <label className="chip" style={{ width: "fit-content", cursor: "pointer" }}><input id="enabled" type="checkbox" name="enabled" defaultChecked={s?.paystack_enabled} /> Offer Paystack at checkout</label>
          <div className="field"><span>Your webhook URL (paste into Paystack)</span><code className="input mono" style={{ overflowWrap: "anywhere", display: "block" }}>{webhook}</code>
            <small>Orders paid by Paystack are confirmed only after we verify the transaction with Paystack directly.</small></div>
          <div><button className="btn btn-ink">Save Paystack</button></div>
        </form>
      </div>

      <form action={saveWhatsApp} className="panel" style={{ marginTop: 16 }}>
        <h2>WhatsApp</h2>
        <p style={{ color: "var(--ink-70)", fontSize: 14 }}>
          {wa ? <>Connected: number ID <b className="mono">{wa.external_id}</b>{wa.display_name ? <> ({wa.display_name})</> : null}. Enter a token below to replace it.</>
            : <>Not connected yet. Customers who message your WhatsApp number will be answered by your assistant.</>}
        </p>
        <div className="form-grid">
          <label className="field"><span>Phone number ID</span><input id="phone_number_id" name="phone_number_id" className="input mono" inputMode="numeric" defaultValue={wa?.external_id ?? ""} placeholder="From Meta → WhatsApp → API Setup" /></label>
          <label className="field"><span>Display name (optional)</span><input id="display_name" name="display_name" className="input" defaultValue={wa?.display_name ?? ""} placeholder="e.g. Mama Ngozi Kitchen" /></label>
        </div>
        <label className="field"><span>Access token</span><input id="access_token" name="access_token" type="password" autoComplete="off" className="input mono" placeholder="EAA… (permanent system-user token)" />
          <small>Encrypted before it&apos;s stored. It is never shown again.</small></label>
        <div className="field"><span>Callback URL (paste into Meta → WhatsApp → Configuration)</span><code className="input mono" style={{ overflowWrap: "anywhere", display: "block" }}>{waCallback}</code>
          <small>Meta also asks for a verify token. Your developer sets it as WHATSAPP_VERIFY_TOKEN.</small></div>
        <div><button className="btn btn-ink">Save WhatsApp</button></div>
      </form>
    </>
  );
}
