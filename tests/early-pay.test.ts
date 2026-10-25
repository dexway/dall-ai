import { test } from "node:test";
import assert from "node:assert/strict";
import { earlyPayAmount, acceptableAmounts } from "../lib/early-pay.ts";
import { profileText } from "../lib/business-profile.ts";

test("early amount is the percent off, rounded to the kobo, never above the total", () => {
  assert.equal(earlyPayAmount(1_000_000, 5), 950_000);
  assert.equal(earlyPayAmount(333_333, 10), 300_000); // 299,999.7 rounds to the kobo
  assert.equal(earlyPayAmount(1_000_000, 0), 1_000_000);
  assert.equal(earlyPayAmount(1_000_000, -3), 1_000_000);
  assert.ok(earlyPayAmount(1, 15) <= 1);
});

test("the early amount counts only while the countdown runs; the full total always counts", () => {
  const order = { total_kobo: 1_000_000, early_total_kobo: 950_000, expires_at: "2026-10-25T12:00:00Z" };
  assert.deepEqual(acceptableAmounts(order, new Date("2026-10-25T11:30:00Z")), [1_000_000, 950_000]);
  assert.deepEqual(acceptableAmounts(order, new Date("2026-10-25T12:30:00Z")), [1_000_000]);
});

test("no bonus on the order means only the total is acceptable", () => {
  const order = { total_kobo: 500_000, early_total_kobo: null, expires_at: null };
  assert.deepEqual(acceptableAmounts(order, new Date()), [500_000]);
});

test("profile text lists only the fields that are filled in", () => {
  const text = profileText({ delivery_time: "Same day for Lekki before 2pm", opening_hours: "  ", notes: "" });
  assert.equal(text, "- Usual delivery time: Same day for Lekki before 2pm");
  assert.equal(profileText(null), "");
});
