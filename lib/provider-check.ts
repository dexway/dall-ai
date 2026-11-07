import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

// Runs read-only calls against the platform's telecom (KrosAI), voice (Vapi) and WhatsApp (Kapso)
// accounts and stores the responses, minus anything secret-looking, so integrations can be checked
// against real API shapes. Nothing is bought, created or dialled.

const SECRET = /pass(word)?|secret|token|api_?key|authorization|credential|sip_auth/i;
function scrub(v: unknown, depth = 0): unknown {
  if (depth > 6) return "…";
  if (Array.isArray(v)) return v.slice(0, 5).map((x) => scrub(x, depth + 1));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SECRET.test(k) ? "[removed]" : scrub(x, depth + 1)]));
  return typeof v === "string" && v.length > 400 ? `${v.slice(0, 400)}…` : v;
}

async function get(url: string, headers: Record<string, string>) {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    const text = await r.text();
    let body: unknown = text.slice(0, 2000);
    try { body = JSON.parse(text); } catch { /* keep text */ }
    return { status: r.status, body: scrub(body) };
  } catch (e) { return { status: 0, body: (e as Error).message }; }
}

export async function runPendingProviderChecks(): Promise<number> {
  const db = supabaseAdmin();
  const { data: pending } = await db.from("provider_checks").select("id").is("ran_at", null).order("requested_at").limit(1);
  if (!pending?.length) return 0;
  const kros = process.env.KROSAI_API_KEY, vapi = process.env.VAPI_API_KEY, kapso = process.env.KAPSO_API_KEY || process.env.KAPSOAIAPKIKEY;
  const K = "https://api.krosai.com/api/v1", kh = { Authorization: `Bearer ${kros}` };
  const result: Record<string, unknown> = { keys: { krosai: !!kros, vapi: !!vapi, kapso: !!kapso } };
  if (kros) {
    result.kros_org = await get(`${K}/organization`, kh);
    for (const c of ["NG", "GH", "KE", "US"]) result[`kros_available_${c}`] = await get(`${K}/phone-numbers/available?country_code=${c}&limit=3`, kh);
    result.kros_owned = await get(`${K}/phone-numbers?limit=5`, kh);
    result.kros_endpoints = await get(`${K}/endpoints?limit=3`, kh);
    result.kros_integrations = await get(`${K}/provider-integrations`, kh);
  }
  if (vapi) {
    const vh = { Authorization: `Bearer ${vapi}` };
    result.vapi_assistants = await get("https://api.vapi.ai/assistant?limit=2", vh);
    result.vapi_phone_numbers = await get("https://api.vapi.ai/phone-number?limit=3", vh);
  }
  if (kapso) {
    const ph = { "X-API-Key": kapso };
    result.kapso_customers = await get("https://api.kapso.ai/platform/v1/customers?per_page=2", ph);
    result.kapso_numbers = await get("https://api.kapso.ai/platform/v1/whatsapp/phone_numbers?per_page=3", ph);
  }
  await db.from("provider_checks").update({ ran_at: new Date().toISOString(), result }).eq("id", pending[0].id);
  return 1;
}
