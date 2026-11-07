import { after } from "next/server";
import { signatureValid } from "@/lib/channels/whatsapp-parse";
import { parseWhatsAppEvents } from "@/lib/channels/events";
import { ingestEvents } from "@/lib/channels/process";
import { kapsoSignatureValid } from "@/lib/channels/kapso";

export const maxDuration = 60;

// Meta (or Kapso, for numbers set up through Dall AI) posts every customer message and delivery status here (POST).
// Meta calls GET once to verify the URL.
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
  // Meta signs with the app secret; Kapso (Get WhatsApp in minutes) relays the same Meta payload signed with Dall AI's Kapso secret.
  const fromMeta = signatureValid(raw, req.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET ?? "");
  if (!fromMeta && !kapsoSignatureValid(raw, req.headers.get("x-webhook-signature"))) {
    return new Response("bad signature", { status: 401 });
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  const events = parseWhatsAppEvents(body);
  after(async () => {
    try { await ingestEvents("whatsapp", events); } catch (e) { console.error("[whatsapp] ingest failed", (e as Error).message); }
  });
  return new Response("ok", { status: 200 });
}
