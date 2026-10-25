import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { signatureValid, parseInbound } from "../lib/channels/whatsapp-parse.ts";

const SECRET = "test-app-secret";
const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
const sign = (b: string, s = SECRET) => "sha256=" + createHmac("sha256", s).update(b, "utf8").digest("hex");

test("accepts a correctly signed body", () => {
  assert.equal(signatureValid(body, sign(body), SECRET), true);
});
test("rejects a wrong secret, a changed body, a missing or malformed header", () => {
  assert.equal(signatureValid(body, sign(body, "other"), SECRET), false);
  assert.equal(signatureValid(body + " ", sign(body), SECRET), false);
  assert.equal(signatureValid(body, null, SECRET), false);
  assert.equal(signatureValid(body, "sha256=zz", SECRET), false);
  assert.equal(signatureValid(body, sign(body), ""), false);
});

test("parses text messages with the sender's name and the number they wrote to", () => {
  const payload = {
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "1098765" },
      contacts: [{ wa_id: "2348012345678", profile: { name: "Ada" } }],
      messages: [{ id: "wamid.A", from: "2348012345678", type: "text", text: { body: "How much is jollof?" } }],
    } }] }],
  };
  assert.deepEqual(parseInbound(payload), [{
    phoneNumberId: "1098765", from: "2348012345678", messageId: "wamid.A", type: "text",
    text: "How much is jollof?", name: "Ada",
  }]);
});

test("non-text messages come through with empty text so the handler can reply politely", () => {
  const payload = { entry: [{ changes: [{ value: {
    metadata: { phone_number_id: "1" },
    messages: [{ id: "wamid.B", from: "234", type: "image" }],
  } }] }] };
  const [m] = parseInbound(payload);
  assert.equal(m.type, "image");
  assert.equal(m.text, "");
});

test("status-only webhooks (delivery receipts) produce no messages", () => {
  const payload = { entry: [{ changes: [{ value: {
    metadata: { phone_number_id: "1" }, statuses: [{ id: "wamid.C", status: "delivered" }],
  } }] }] };
  assert.deepEqual(parseInbound(payload), []);
  assert.deepEqual(parseInbound(null), []);
});
