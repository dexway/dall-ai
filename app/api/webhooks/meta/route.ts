import { after } from "next/server";
import { signatureValid } from "@/lib/channels/whatsapp-parse";
import { parseMetaEvents } from "@/lib/channels/events";
import { ingestEvents } from "@/lib/channels/process";

export const maxDuration = 60;

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
  if (!signatureValid(raw, req.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET ?? "")) {
    return new Response("bad signature", { status: 401 });
  }
  let body: { object?: string };
  try { body = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  const events = parseMetaEvents(body);
  const provider = body.object === "instagram" ? "instagram" : "facebook";
  // Answer Meta quickly; events are stored idempotently and processed right after the response.
  after(async () => {
    try { await ingestEvents(provider, events); } catch (e) { console.error("[meta] ingest failed", (e as Error).message); }
  });
  return new Response("ok", { status: 200 });
}
