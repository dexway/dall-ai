// A team takeover hands the chat back to the assistant once the team goes quiet (no DB).
import { test } from "node:test";
import assert from "node:assert/strict";
import { aiShouldResume, TEAM_TAKEOVER } from "../lib/marketing-rules.ts";

const now = Date.parse("2026-11-06T12:00:00Z");
const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();

test("a quiet team takeover resumes after 2 hours, not before", () => {
  assert.equal(aiShouldResume({ ai_paused: true, handoff_reason: TEAM_TAKEOVER }, ago(3), now), true);
  assert.equal(aiShouldResume({ ai_paused: true, handoff_reason: null }, ago(200), now), true);
  assert.equal(aiShouldResume({ ai_paused: true, handoff_reason: TEAM_TAKEOVER }, ago(1), now), false);
});

test("customer-requested handoffs, unanswered pauses and live chats stay as they are", () => {
  assert.equal(aiShouldResume({ ai_paused: true, handoff_reason: "Customer wants to speak to a person" }, ago(10), now), false);
  assert.equal(aiShouldResume({ ai_paused: true, handoff_reason: TEAM_TAKEOVER }, null, now), false);
  assert.equal(aiShouldResume({ ai_paused: false, handoff_reason: null }, ago(10), now), false);
});
