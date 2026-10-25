import { signatureValid, parseInbound } from "@/lib/channels/whatsapp-parse";
import { handleWhatsAppInbound } from "@/lib/channels/whatsapp-inbound";

// Meta calls this once to verify the URL (GET), then posts every customer message here (POST).
export async function GET(req: Request) {
  const u = new URL(req.url);
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
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

  // Always answer 200 once the signature is good, so Meta does not resend the same batch.
  // Failures are logged and visible in Vercel runtime logs.
  for (const msg of parseInbound(body)) {
    try { await handleWhatsAppInbound(msg); }
    catch (e) { console.error("[whatsapp] handle failed", (e as Error).message); }
  }
  return new Response("ok", { status: 200 });
}
