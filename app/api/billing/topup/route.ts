import { NextResponse } from "next/server";
import { requireWorkspace, canManage } from "@/lib/workspace";
import { supabaseAdmin } from "@/lib/supabase/server";
import { initializeTransaction } from "@/lib/paystack";
import { serverEnv } from "@/lib/env";
import { TOP_UPS } from "@/lib/config";

// Platform billing: the business buys credits from Dall AI (Dall AI's Paystack account).
export async function POST(req: Request) {
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) return NextResponse.json({ error: "Only owners and admins can top up." }, { status: 403 });
  const secret = serverEnv.platformPaystackSecret();
  if (!secret) return NextResponse.json({ error: "Top-ups aren't switched on yet." }, { status: 503 });
  const { pack } = await req.json().catch(() => ({}));
  const db0 = supabaseAdmin();
  let p: { credits: number; amount_kobo: number; plan_id?: string } | undefined = TOP_UPS.find((t) => t.id === pack);
  if (!p && typeof pack === "string" && pack.startsWith("plan:")) {
    // Price and credits come from the plans table, never from the browser.
    const { data: plan } = await db0.from("platform_plans").select("id,price_kobo,monthly_credits,is_trial,active").eq("id", pack.slice(5)).maybeSingle();
    if (plan && plan.active && !plan.is_trial && plan.price_kobo > 0) p = { credits: Number(plan.monthly_credits), amount_kobo: Number(plan.price_kobo), plan_id: plan.id };
  }
  if (!p) return NextResponse.json({ error: "Unknown credit pack or plan." }, { status: 400 });
  if (!ctx.user.email) return NextResponse.json({ error: "Your account needs an email address." }, { status: 400 });

  const reference = `TOP-${ctx.workspace.slug.slice(0, 10).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  const db = supabaseAdmin();
  const { error } = await db.from("credit_top_up_orders").insert({ workspace_id: ctx.workspace.id, credits: p.credits, amount_kobo: p.amount_kobo, plan_id: p.plan_id ?? null, reference, created_by: ctx.user.id });
  if (error) return NextResponse.json({ error: "Couldn't start the top-up." }, { status: 500 });
  try {
    const init = await initializeTransaction(secret, {
      email: ctx.user.email, amount_kobo: p.amount_kobo, reference,
      callback_url: `${serverEnv.siteUrl()}/dashboard/billing?topup=ok`,
      metadata: { kind: "topup", workspace_id: ctx.workspace.id },
    });
    return NextResponse.json({ url: init.authorization_url });
  } catch {
    await db.from("credit_top_up_orders").update({ status: "failed" }).eq("reference", reference);
    return NextResponse.json({ error: "Paystack is not responding. Try again shortly." }, { status: 502 });
  }
}
