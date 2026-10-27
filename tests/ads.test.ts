// MOCKED: a fake fetch records the Marketing API calls; no live Meta calls are made here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setDelivery, updateAdSet, updateAdText, dailyInsights, parseInsightRow, validateAdEdit, MetaApiError } from "../lib/ads.ts";

type Call = { method: string; url: string; body?: Record<string, unknown> };
function fake(responses: Record<string, unknown> = {}, fail?: (c: Call) => Response | null) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const c: Call = { method: String(init.method), url, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const bad = fail?.(c);
    if (bad) return bad;
    const key = Object.keys(responses).find((k) => url.includes(k));
    return new Response(JSON.stringify(key ? responses[key] : { success: true }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

test("pause touches only the campaign; resume switches ad, ad set and campaign on", async () => {
  const p = fake();
  await setDelivery("t", { campaignId: "C1", adsetId: "S1", adId: "A1" }, "PAUSED", p.fetcher);
  assert.deepEqual(p.calls.map((c) => [c.url.split("/").pop(), c.body?.status]), [["C1", "PAUSED"]]);
  const r = fake();
  await setDelivery("t", { campaignId: "C1", adsetId: "S1", adId: "A1" }, "ACTIVE", r.fetcher);
  assert.deepEqual(r.calls.map((c) => c.url.split("/").pop()), ["A1", "S1", "C1"]);
  assert.ok(r.calls.every((c) => c.method === "POST" && c.body?.status === "ACTIVE"));
});

test("a Meta rejection surfaces as an error (no silent success)", async () => {
  const f = fake({}, () => new Response('{"error":{"message":"Invalid parameter","code":100}}', { status: 400 }));
  await assert.rejects(setDelivery("t", { campaignId: "C1" }, "PAUSED", f.fetcher), (e: unknown) => e instanceof MetaApiError && e.status === 400);
});

test("budget and schedule edits go to the ad set; clearing the end date sends 0", async () => {
  const f = fake();
  await updateAdSet("t", "S1", { dailyBudgetMinor: 300000, endTime: "2026-11-30T22:59:00.000Z" }, f.fetcher);
  await updateAdSet("t", "S1", { endTime: null }, f.fetcher);
  await updateAdSet("t", "S1", {}, f.fetcher);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[0].body, { daily_budget: 300000, end_time: "2026-11-30T22:59:00.000Z" });
  assert.deepEqual(f.calls[1].body, { end_time: 0 });
});

test("editing ad text copies the creative with new text and points the ad at it", async () => {
  const f = fake({
    "A1?fields": { creative: { id: "CR1", name: "Dall AI · Jollof", object_story_spec: { page_id: "P1", link_data: { image_hash: "H", link: "https://api.whatsapp.com/send", name: "Jollof", message: "old", call_to_action: { type: "WHATSAPP_MESSAGE" } } } } },
    "adcreatives": { id: "CR2" },
  });
  const id = await updateAdText("t", "act_9", "A1", { message: "New text here", headline: "Party trays" }, f.fetcher);
  assert.equal(id, "CR2");
  const create = f.calls.find((c) => c.url.includes("adcreatives"))!;
  const ld = (create.body!.object_story_spec as { link_data: Record<string, unknown> }).link_data;
  assert.equal(ld.message, "New text here"); assert.equal(ld.name, "Party trays"); assert.equal(ld.image_hash, "H");
  const point = f.calls[f.calls.length - 1];
  assert.ok(point.url.endsWith("/A1")); assert.deepEqual(point.body, { creative: { creative_id: "CR2" } });
});

test("insights: spend to minor units, Meta's messaging and lead actions, and paging", async () => {
  const row = parseInsightRow({ date_start: "2026-10-26", spend: "1520.75", impressions: "3400", reach: "2100", clicks: "88",
    actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "12" }, { action_type: "lead", value: "3" }, { action_type: "link_click", value: "80" }] });
  assert.deepEqual(row, { day: "2026-10-26", spend_minor: 152075, impressions: 3400, reach: 2100, clicks: 88, conversations_started: 12, leads: 3 });
  let n = 0;
  const pager = (async () => {
    n++;
    return new Response(JSON.stringify(n === 1
      ? { data: [{ date_start: "2026-10-25", spend: "10" }], paging: { next: "https://graph.facebook.com/v26.0/C1/insights?after=abc" } }
      : { data: [{ date_start: "2026-10-26", spend: "20" }] }), { status: 200 });
  }) as typeof fetch;
  const rows = await dailyInsights("t", "C1", "2026-10-25", "2026-10-26", pager);
  assert.deepEqual(rows.map((r) => [r.day, r.spend_minor]), [["2026-10-25", 1000], ["2026-10-26", 2000]]);
});

test("edits are validated before reaching Meta", () => {
  const now = Date.parse("2026-10-27T00:00:00Z");
  assert.match(validateAdEdit({ dailyBudgetMinor: 100000, currency: "NGN" }, now)!, /₦1,500/);
  assert.equal(validateAdEdit({ dailyBudgetMinor: 200000, currency: "NGN" }, now), null);
  assert.match(validateAdEdit({ dailyBudgetMinor: 0, currency: "USD" }, now)!, /more than zero/);
  assert.match(validateAdEdit({ currency: "NGN", endTime: "2026-10-26T00:00:00Z" }, now)!, /hour from now/);
  assert.match(validateAdEdit({ currency: "NGN", message: "hi" }, now)!, /between 5 and 600/);
  assert.match(validateAdEdit({ currency: "NGN", headline: "x".repeat(41) }, now)!, /40/);
});
