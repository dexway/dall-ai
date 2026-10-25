import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMetaWebhook } from "../lib/channels/meta-parse.ts";

test("parses a Messenger text message and reads the Page as the account", () => {
  const body = { object: "page", entry: [{ id: "PAGE1", time: 1, messaging: [
    { sender: { id: "PSID9" }, recipient: { id: "PAGE1" }, timestamp: 5, message: { mid: "m.1", text: "price of jollof?" } },
  ] }] };
  assert.deepEqual(parseMetaWebhook(body), [{ channel: "facebook", accountId: "PAGE1", senderId: "PSID9", messageId: "m.1", text: "price of jollof?" }]);
});

test("parses an Instagram DM and marks non-text as empty", () => {
  const body = { object: "instagram", entry: [{ id: "IG1", time: 1, messaging: [
    { sender: { id: "IGSID2" }, recipient: { id: "IG1" }, timestamp: 6, message: { mid: "m.2", attachments: [{ type: "image" }] } },
  ] }] };
  const [m] = parseMetaWebhook(body);
  assert.equal(m.channel, "instagram");
  assert.equal(m.text, "");
  assert.equal(m.accountId, "IG1");
});

test("drops our own echoed replies, unknown objects and events without a sender", () => {
  const echo = { object: "page", entry: [{ id: "PAGE1", messaging: [
    { sender: { id: "PAGE1" }, recipient: { id: "PSID9" }, message: { mid: "m.3", text: "hi", is_echo: true } },
  ] }] };
  assert.deepEqual(parseMetaWebhook(echo), []);
  assert.deepEqual(parseMetaWebhook({ object: "whatsapp_business_account", entry: [] }), []);
  assert.deepEqual(parseMetaWebhook({ object: "page", entry: [{ id: "P", messaging: [{ message: { mid: "x" } }] }] }), []);
  assert.deepEqual(parseMetaWebhook(null), []);
});
