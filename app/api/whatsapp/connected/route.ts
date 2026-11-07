import { NextResponse } from "next/server";
import { requireWorkspace, canManage } from "@/lib/workspace";
import { supabaseAdmin } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";
import { serverEnv } from "@/lib/env";
import { KAPSO_TOKEN, getKapsoNumber, subscribeKapsoNumber } from "@/lib/channels/kapso";

// Where the WhatsApp setup page sends the business back. The number is only saved after the provider
// confirms it belongs to this business's own customer account, so the query string can't be forged.

const back = (q: string) => NextResponse.redirect(`${serverEnv.siteUrl()}/dashboard/connect?c=whatsapp&${q}`);

export async function GET(req: Request) {
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) return back("error=role");
  const u = new URL(req.url);
  if (u.searchParams.get("failed")) return back(`error=setup&why=${encodeURIComponent(u.searchParams.get("error_code") ?? "")}`);
  const phoneId = (u.searchParams.get("phone_number_id") ?? "").replace(/[^\w-]/g, "");
  if (!phoneId) return back("error=missing");

  const db = supabaseAdmin();
  const { data: ws } = await db.from("workspaces").select("kapso_customer_id").eq("id", ctx.workspace.id).single();
  try {
    const n = await getKapsoNumber(phoneId);
    if (!ws?.kapso_customer_id || n.customerId !== ws.kapso_customer_id) return back("error=taken");
    const { data: other } = await db.from("channel_connections").select("workspace_id").eq("provider", "whatsapp").eq("external_id", n.phoneNumberId).maybeSingle();
    if (other && other.workspace_id !== ctx.workspace.id) return back("error=taken");
    await subscribeKapsoNumber(n.phoneNumberId);
    const { error } = await db.from("channel_connections").upsert({
      workspace_id: ctx.workspace.id, provider: "whatsapp", external_id: n.phoneNumberId,
      display_name: [n.name, n.display].filter(Boolean).join(" · ") || null,
      access_token_enc: encryptSecret(KAPSO_TOKEN), status: "active", last_error: null, waba_id: n.wabaId,
    }, { onConflict: "provider,external_id" });
    if (error) return back("error=save");
    await db.from("financial_audit_logs").insert({ workspace_id: ctx.workspace.id, actor_id: ctx.user.id, action: "channel.whatsapp_connected", entity: "workspace", entity_id: ctx.workspace.id, details: { phone_number_id: n.phoneNumberId, via: "managed" } });
  } catch (e) {
    console.error("[whatsapp] managed connect failed", (e as Error).message);
    return back("error=meta");
  }
  return back("saved=connected");
}
