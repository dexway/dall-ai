// MOCKED: payload shapes follow Meta's webhook docs; no live Meta calls are made here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWhatsAppEvents, parseMetaEvents, eventKey, replyWindow, describeForAgent } from "../lib/channels/events.ts";
import { postWithRetry, sendText, SendError } from "../lib/channels/send.ts";

const wa = (value: object) => ({ object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "PN1" }, ...value } }] }] });

test("WhatsApp: text, click-to-WhatsApp ad referral and contact name", () => {
  const [e] = parseWhatsAppEvents(wa({
    contacts: [{ wa_id: "2348011112222", profile: { name: "Amaka" } }],
    messages: [{ id: "wamid.A", from: "2348011112222", timestamp: "1730000000", type: "text", text: { body: "Is the jollof tray available?" },
      referral: { source_type: "ad", source_id: "120200001", headline: "Party jollof", ctwa_clid: "clid123", source_url: "https://fb.me/x" } }],
  }));
  assert.equal(e.kind, "message");
  if (e.kind !== "message") return;
  assert.equal(e.accountId, "PN1"); assert.equal(e.contactId, "2348011112222"); assert.equal(e.contactName, "Amaka");
  assert.equal(e.text, "Is the jollof tray available?");
  assert.deepEqual(e.referral, { source: "ad", adId: "120200001", ctwaClid: "clid123", headline: "Party jollof", sourceUrl: "https://fb.me/x" });
  assert.equal(e.timestamp, 1730000000000);
  assert.equal(eventKey(e), "msg:wamid.A");
});

test("WhatsApp: image with caption keeps the attachment; button replies become text; statuses map", () => {
  const evs = parseWhatsAppEvents(wa({
    messages: [
      { id: "wamid.B", from: "234", type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg", caption: "my receipt" } },
      { id: "wamid.C", from: "234", type: "interactive", interactive: { button_reply: { title: "Yes, order" } } },
    ],
    statuses: [
      { id: "wamid.OUT1", status: "delivered", timestamp: "1730000100", recipient_id: "234" },
      { id: "wamid.OUT2", status: "failed", recipient_id: "234", errors: [{ code: 131047, title: "Re-engagement message" }] },
      { id: "wamid.OUT3", status: "deleted" },
    ],
  }));
  assert.equal(evs.length, 4);
  const [img, btn, ok, bad] = evs;
  assert.ok(img.kind === "message" && img.attachments[0].type === "image" && img.attachments[0].id === "MEDIA1" && img.text === "my receipt");
  assert.ok(btn.kind === "message" && btn.text === "Yes, order");
  assert.ok(ok.kind === "status" && ok.status === "delivered" && ok.providerMessageId === "wamid.OUT1");
  assert.ok(bad.kind === "status" && bad.status === "failed" && bad.error === "131047 Re-engagement message");
  assert.equal(eventKey(ok), "st:wamid.OUT1:delivered");
});

test("Messenger: message with ad referral, OPEN_THREAD referral, delivery and read receipts; echoes dropped", () => {
  const evs = parseMetaEvents({ object: "page", entry: [{ id: "PAGE1", time: 1, messaging: [
    { sender: { id: "PSID1" }, recipient: { id: "PAGE1" }, timestamp: 10, message: { mid: "m.1", text: "price?", referral: { ref: "jollof", ad_id: "AD9", source: "ADS", type: "OPEN_THREAD", ads_context_data: { ad_title: "Jollof promo" } } } },
    { sender: { id: "PSID2" }, recipient: { id: "PAGE1" }, timestamp: 11, referral: { ad_id: "AD9", source: "ADS", type: "OPEN_THREAD" } },
    { sender: { id: "PSID1" }, recipient: { id: "PAGE1" }, timestamp: 12, delivery: { mids: ["m.out1", "m.out2"], watermark: 12 } },
    { sender: { id: "PSID1" }, recipient: { id: "PAGE1" }, timestamp: 13, read: { watermark: 13 } },
    { sender: { id: "PAGE1" }, recipient: { id: "PSID1" }, timestamp: 14, message: { mid: "m.echo", text: "hi", is_echo: true } },
    { sender: { id: "PSID3" }, recipient: { id: "PAGE1" }, timestamp: 15, postback: { mid: "m.pb", title: "Get started", payload: "START" } },
  ] }] });
  assert.equal(evs.length, 6);
  const [msg, ref, d1, d2, read, pb] = evs;
  assert.ok(msg.kind === "message" && msg.provider === "facebook" && msg.referral?.adId === "AD9" && msg.referral.source === "ad" && msg.referral.headline === "Jollof promo");
  assert.ok(ref.kind === "referral" && ref.referral.adId === "AD9");
  assert.ok(d1.kind === "status" && d1.providerMessageId === "m.out1" && d2.kind === "status" && d2.providerMessageId === "m.out2");
  assert.ok(read.kind === "read" && read.watermark === 13);
  assert.ok(pb.kind === "message" && pb.text === "Get started");
});

test("Instagram DM: object instagram maps to provider instagram, attachments kept", () => {
  const [e] = parseMetaEvents({ object: "instagram", entry: [{ id: "IG1", messaging: [
    { sender: { id: "IGSID" }, recipient: { id: "IG1" }, timestamp: 5, message: { mid: "ig.1", attachments: [{ type: "image", payload: { url: "https://cdn/x.jpg" } }] } },
  ] }] });
  assert.ok(e.kind === "message" && e.provider === "instagram" && e.attachments[0].url === "https://cdn/x.jpg" && e.text === "");
  assert.match(describeForAgent(e), /sent a photo/);
  assert.deepEqual(parseMetaEvents({ object: "user" }), []);
  assert.deepEqual(parseWhatsAppEvents(null), []);
});

test("messaging windows: 24h for everyone, 7-day human tag on Messenger/IG, WhatsApp needs a template", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  const h = (n: number) => new Date(now - n * 3600_000).toISOString();
  assert.deepEqual(replyWindow("whatsapp", h(23), "agent", now), { ok: true });
  const waLate = replyWindow("whatsapp", h(25), "human", now);
  assert.ok(!waLate.ok && waLate.needsTemplate);
  assert.deepEqual(replyWindow("facebook", h(48), "human", now), { ok: true, tag: "HUMAN_AGENT" });
  assert.ok(!replyWindow("facebook", h(48), "agent", now).ok);
  assert.ok(!replyWindow("instagram", h(24 * 8), "human", now).ok);
  assert.ok(!replyWindow("whatsapp", null, "agent", now).ok);
  assert.deepEqual(replyWindow("web", null, "agent", now), { ok: true });
});

test("send: retries once on 429/5xx, returns the platform id, and throws (never fakes success) on rejection", async () => {
  let calls = 0;
  const flaky = (async () => { calls++; return calls === 1 ? new Response("busy", { status: 503 }) : new Response(JSON.stringify({ messages: [{ id: "wamid.SENT" }] }), { status: 200 }); }) as typeof fetch;
  const r = await sendText({ provider: "whatsapp", token: "t", accountId: "PN1", to: "234", text: "hi", fetcher: flaky });
  assert.equal(r.providerMessageId, "wamid.SENT"); assert.equal(calls, 2);

  let seen: { url: string; body: Record<string, unknown> } | null = null;
  const capture = (async (url: string, init: RequestInit) => { seen = { url, body: JSON.parse(String(init.body)) }; return new Response(JSON.stringify({ message_id: "m.out" }), { status: 200 }); }) as unknown as typeof fetch;
  const m = await sendText({ provider: "facebook", token: "t", accountId: "PAGE1", to: "PSID", text: "hello", tag: "HUMAN_AGENT", fetcher: capture });
  assert.equal(m.providerMessageId, "m.out");
  assert.equal(seen!.body.messaging_type, "MESSAGE_TAG"); assert.equal(seen!.body.tag, "HUMAN_AGENT");

  const denied = (async () => new Response('{"error":{"code":190}}', { status: 400 })) as typeof fetch;
  await assert.rejects(postWithRetry("https://x", "t", {}, denied, 1), (e: unknown) => e instanceof SendError && e.status === 400 && !e.retryable);
  let n = 0;
  const down = (async () => { n++; return new Response("x", { status: 500 }); }) as typeof fetch;
  await assert.rejects(postWithRetry("https://x", "t", {}, down, 1));
  assert.equal(n, 2);
});
