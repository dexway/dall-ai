// AI phone calls: number cleanup, contact lists, campaign limits and provider statuses (no network, no DB).
import { test } from "node:test";
import assert from "node:assert/strict";
import { toE164, parseContacts, slotsFree, callStatus, voicePrompt, isVoice } from "../lib/voice/rules.ts";

test("Nigerian and international numbers become E.164; junk is refused", () => {
  assert.equal(toE164("0803 123 4567"), "+2348031234567");
  assert.equal(toE164("2348031234567"), "+2348031234567");
  assert.equal(toE164("+234 (803) 123-4567"), "+2348031234567");
  assert.equal(toE164("00447700900123"), "+447700900123");
  assert.equal(toE164("024 123 4567", "GH"), "+233241234567");
  assert.equal(toE164("12"), null);
  assert.equal(toE164("call me"), null);
});

test("contact lists: name either side, CSV header skipped, duplicates and bad lines reported", () => {
  const { contacts, rejected } = parseContacts("name,phone\nChioma, 0803 123 4567\n+2348091234567, Tunde\n08031234567\nno number here\n0809 999 0000");
  assert.deepEqual(contacts, [
    { name: "Chioma", e164: "+2348031234567" },
    { name: "Tunde", e164: "+2348091234567" },
    { name: null, e164: "+2348099990000" },
  ]);
  assert.deepEqual(rejected, ["no number here"]);
  assert.equal(parseContacts("08031234567\n08031234568\n08031234569", "NG", 2).contacts.length, 2);
});

test("campaigns never exceed concurrency or the owner's minutes cap", () => {
  assert.equal(slotsFree({ max_concurrent: 3, max_minutes: 30, minutes_used: 0 }, 1), 2);
  assert.equal(slotsFree({ max_concurrent: 3, max_minutes: 30, minutes_used: 0 }, 3), 0);
  assert.equal(slotsFree({ max_concurrent: 5, max_minutes: 30, minutes_used: 27 }, 0), 1);
  assert.equal(slotsFree({ max_concurrent: 5, max_minutes: 30, minutes_used: 29.5 }, 0), 0);
});

test("provider statuses map to ours; the voice prompt is phone-style and carries the knowledge", () => {
  assert.equal(callStatus("ringing"), "dialing");
  assert.equal(callStatus("in-progress"), "in_progress");
  assert.equal(callStatus("no_answer"), "no_answer");
  assert.equal(callStatus("customer-busy"), "busy");
  assert.equal(callStatus("ended"), "completed");
  assert.equal(callStatus("weird"), null);
  const p = voicePrompt({ agentName: "Amaka", businessName: "WaterCress", persona: "", profile: "", knowledge: "Deluxe Room ₦230,000 per night", instructions: "", goal: "Book a room" });
  assert.match(p, /Amaka, speaking on the phone for WaterCress/);
  assert.match(p, /Deluxe Room ₦230,000/);
  assert.match(p, /Goal of this call: Book a room/);
  assert.ok(isVoice("female_ng") && !isVoice("robot"));
});
