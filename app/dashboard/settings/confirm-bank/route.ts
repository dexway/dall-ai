import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { requireWorkspace } from "@/lib/workspace";
import { supabaseAdmin } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";

// Landing for the bank-change email link. Applies the change only for the same login,
// the same business, inside 30 minutes, and only once.
export async function GET(req: Request) {
  const site = serverEnv.siteUrl();
  const ctx = await requireWorkspace();
  const t = new URL(req.url).searchParams.get("t") ?? "";
  const db = supabaseAdmin();
  const { data: r } = await db.from("bank_change_requests").select("*")
    .eq("token_hash", createHash("sha256").update(t).digest("hex")).eq("status", "pending").maybeSingle();
  if (!t || !r || r.workspace_id !== ctx.workspace.id || r.requested_by !== ctx.user.id || new Date(r.expires_at) < new Date())
    return NextResponse.redirect(`${site}/dashboard/settings?error=bank_link`);
  const { data: claimed } = await db.from("bank_change_requests").update({ status: "applied", applied_at: new Date().toISOString() })
    .eq("id", r.id).eq("status", "pending").select("id");
  if (!claimed?.length) return NextResponse.redirect(`${site}/dashboard/settings?error=bank_link`);
  await db.from("business_payment_settings").update({
    bank_name: r.bank_name, account_name: r.account_name, account_number: r.account_number, updated_at: new Date().toISOString(),
  }).eq("workspace_id", r.workspace_id);
  await db.from("financial_audit_logs").insert({ workspace_id: r.workspace_id, action: "bank.change_confirmed", entity: "bank", entity_id: r.workspace_id, details: { by: ctx.user.id, account_last4: r.account_number?.slice(-4) ?? null } });
  return NextResponse.redirect(`${site}/dashboard/settings?saved=bank_confirmed`);
}
