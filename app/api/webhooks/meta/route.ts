import { signatureValid } from "@/lib/channels/whatsapp-parse";
import { parseMetaWebhook } from "@/lib/channels/meta-parse";
import { handleMetaInbound } from "@/lib/channels/meta-inbound";

// Messenger (object "page") and Instagram DMs (object "instagram") both arrive here.
export async function GET(req: Request) {
  const u = new URL(req.url);
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (expected && u.searchParams.get("hub.mode") === "subscribe" && u.searchParams.get("hub.verify_token") === expected) {
    return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  const appSecret = process.env.META_APP_SECRET ?? "";
  if (!signatureValid(raw, req.headers.get("x-hub-signature-256"), appSecret)) {
    return new Response("bad signature", { status: 401 });
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  for (const msg of parseMetaWebhook(body)) {
    try { await handleMetaInbound(msg); }
    catch (e) { console.error("[meta] handle failed", (e as Error).message); }
  }
  return new Response("ok", { status: 200 });
}
