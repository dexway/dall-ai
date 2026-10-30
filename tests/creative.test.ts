// MOCKED: Higgsfield and Claude are never called for real here; a fake fetch records requests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { applyPromo, promoUnavailable, describePromo, type Promo } from "../lib/promo.ts";
import { buildQuote } from "../lib/money.ts";
import { unpaidNudgeDue, quietLeadDue, broadcastEligibility } from "../lib/marketing-rules.ts";
import { isOptOut } from "../lib/channels/events.ts";
import { ResearchReport, enforceSources, missingBrief, parseJson, Strategy, CalendarItem, ProductionSpec } from "../lib/creative/schemas.ts";
import { estimateCost, providerInput, quotaMessage, canMoveItem, EDITABLE_BY_AI, jobStatusFrom, NOT_CHARGED } from "../lib/creative/rules.ts";
import { hfSubmit, hfOutputs, verifyHfWebhook, HfError } from "../lib/creative/higgsfield.ts";

const cat = [{ id: "a", name: "Jollof tray", price_kobo: 3_500_000, intro_price_kobo: null, stock: null, active: true },
  { id: "b", name: "Zobo", price_kobo: 200_000, intro_price_kobo: null, stock: null, active: true }];
const promo = (o: Partial<Promo> = {}): Promo => ({ id: "p", code: "JOLLOF10", title: "Weekend deal", kind: "percent", value: 10, min_order_kobo: 0, max_discount_kobo: null,
  item_ids: null, starts_at: "2026-01-01T00:00:00Z", ends_at: null, max_uses: null, uses: 0, active: true, ...o });

test("promotions: percent, fixed, item-limited, min order, caps and expiry are enforced server-side", () => {
  const q = buildQuote([{ item_id: "a", quantity: 1 }, { item_id: "b", quantity: 2 }], cat);
  assert.equal(applyPromo(q, promo()).discount_kobo, 390_000);
  assert.equal(applyPromo(q, promo({ kind: "fixed", value: 5_000_000 })).total_kobo, 0);           // never below zero
  assert.equal(applyPromo(q, promo({ item_ids: ["b"] })).discount_kobo, 40_000);                     // only the zobo
  assert.equal(applyPromo(q, promo({ max_discount_kobo: 100_000 })).discount_kobo, 100_000);
  assert.throws(() => applyPromo(q, promo({ min_order_kobo: 5_000_000 })), /at least/);
  assert.throws(() => applyPromo(q, promo({ ends_at: "2026-02-01T00:00:00Z" }), new Date("2026-03-01")), /ended/);
  assert.throws(() => applyPromo(q, promo({ max_uses: 5, uses: 5 })), /fully used/);
  assert.throws(() => applyPromo(q, promo({ item_ids: ["zzz"] })), /doesn't cover/);
  assert.equal(promoUnavailable(promo({ starts_at: "2099-01-01T00:00:00Z" })), "That promotion hasn't started yet.");
  assert.match(describePromo(promo({ min_order_kobo: 1_000_000 })), /10% off the order on orders from ₦10,000 \(code JOLLOF10\)/);
});

test("follow-ups: unpaid reminder timing and quiet-chat rules respect windows, takeovers and opt-outs", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  const chat = { channel: "whatsapp", last_inbound_at: new Date(now - 30 * 60_000).toISOString(), last_message_at: null, ai_paused: false, opted_out_at: null, outcome: "open" };
  const order = { created_at: new Date(now - 25 * 60_000).toISOString(), expires_at: new Date(now + 15 * 60_000).toISOString(), status: "awaiting_payment", pay_on_delivery: false };
  assert.equal(unpaidNudgeDue(order, chat, 20, now), true);
  assert.equal(unpaidNudgeDue(order, chat, 30, now), false);                                      // too soon
  assert.equal(unpaidNudgeDue({ ...order, expires_at: new Date(now + 60_000).toISOString() }, chat, 20, now), false); // about to expire
  assert.equal(unpaidNudgeDue(order, { ...chat, ai_paused: true }, 20, now), false);
  assert.equal(unpaidNudgeDue(order, { ...chat, channel: "web" }, 20, now), false);
  assert.equal(unpaidNudgeDue({ ...order, pay_on_delivery: true }, chat, 20, now), false);
  const quiet = { ...chat, last_inbound_at: new Date(now - 21 * 3600_000).toISOString() };
  assert.equal(quietLeadDue(quiet, "assistant", 20, now), true);
  assert.equal(quietLeadDue(quiet, "user", 20, now), false);                                      // we owe them a reply, not a nudge
  assert.equal(quietLeadDue({ ...quiet, last_inbound_at: new Date(now - 24 * 3600_000).toISOString() }, "assistant", 20, now), false); // window closed
  assert.equal(quietLeadDue({ ...quiet, opted_out_at: "2026-10-01T00:00:00Z" }, "assistant", 20, now), false);
  assert.equal(quietLeadDue({ ...quiet, outcome: "won" }, "assistant", 20, now), false);
});

test("broadcast audience: consent required, STOP wins, Messenger/IG limited to the 24h window", () => {
  const now = Date.now();
  const base = { channel: "facebook", marketing_consent: true, opted_out_at: null, last_inbound_at: new Date(now - 3600_000).toISOString() };
  assert.equal(broadcastEligibility(base, "facebook", now), "send");
  assert.equal(broadcastEligibility({ ...base, last_inbound_at: new Date(now - 30 * 3600_000).toISOString() }, "facebook", now), "skip_window");
  assert.equal(broadcastEligibility({ ...base, channel: "whatsapp", last_inbound_at: null }, "whatsapp", now), "send");   // template any time
  assert.equal(broadcastEligibility({ ...base, marketing_consent: false }, "facebook", now), "skip_consent");
  assert.equal(broadcastEligibility({ ...base, opted_out_at: new Date().toISOString() }, "facebook", now), "skip_consent");
  for (const t of ["STOP", "stop", " Unsubscribe ", "opt out", "Stop offers!", "no more messages"]) assert.equal(isOptOut(t), true, t);
  for (const t of ["don't stop", "stop by tomorrow?", "how much"]) assert.equal(isOptOut(t), false, t);
});

const claim = (sources: string[] = []) => ({ text: "x", sources, confidence: "high" as const });
test("research: citations to pages the tools never returned are removed and unsupported claims become hypotheses", () => {
  const raw = ResearchReport.parse({ overview: claim(["https://a.com/post", "https://invented.example/x"]), positioning: claim([]),
    competitors: [{ name: "Rival", sources: ["https://a.com/post/"], confidence: "high" }], trends: [{ ...claim(["https://nope.io"]), date: "2026-10" }] });
  const { report, dropped } = enforceSources(raw, new Set(["https://a.com/post"]));
  assert.equal(dropped, 2);
  assert.deepEqual(report.overview.sources, ["https://a.com/post"]);
  assert.equal(report.competitors[0].sources.length, 1);                                         // trailing slash normalised
  assert.equal(report.trends[0].confidence, "low");
  assert.equal(report.positioning.confidence, "low");
});

test("brief gaps, JSON validation and schema strictness", () => {
  assert.deepEqual(missingBrief({ industry: "food" }, [{ kind: "competitor", accepted: true }, { kind: "competitor", accepted: false }]).length, 6);
  assert.equal(parseJson(Strategy, "no json here").ok, false);
  const bad = parseJson(CalendarItem, '{"planned_date":"tomorrow","platform":"myspace"}');
  assert.equal(bad.ok, false);
  const spec = ProductionSpec.safeParse({ objective: "o", prompt: "p", aspect_ratio: "9:16", output: "video", duration_seconds: 500 });
  assert.equal(spec.success, false);                                                             // 500s rejected before any provider call
});

test("costs: per-image and per-second pricing, capped duration, variations; only allowed params are sent", () => {
  assert.equal(estimateCost({ unit: "image", usd_per_unit: 0.0032, max_seconds: null }, { variations: 3 }), 0.0096);
  assert.equal(estimateCost({ unit: "second", usd_per_unit: 0.112, max_seconds: 10 }, { duration_seconds: 30 }), 1.12);
  const input = providerInput({ allowed_params: ["prompt", "aspect_ratio"], max_seconds: null }, { prompt: "jollof", aspect_ratio: "1:1", negative: "text", variations: 2 });
  assert.deepEqual(input, { prompt: "jollof", aspect_ratio: "1:1" });
});

test("quota errors name the exact limit, usage and reset; unconfigured media spend is off", () => {
  const m = quotaMessage("QUOTA:org:month:10.000000:9.500000", "media_usd", new Date("2026-10-27T00:00:00Z"));
  assert.match(m.message, /your business's monthly media generation budget: \$9\.50 of \$10\.00 used, \$0\.50 left\. It resets on 1 Nov 2026/);
  assert.match(quotaMessage("NOT_CONFIGURED:media_usd", "media_usd").message, /switched off until a Dall AI admin sets a spending cap/);
});

test("approval state machine: no skipping approval, approved items locked from AI rewrites", () => {
  assert.equal(canMoveItem("awaiting_approval", "generation_queued"), false);
  assert.equal(canMoveItem("approved", "generation_queued"), true);
  assert.equal(canMoveItem("rejected", "approved"), false);
  assert.equal(canMoveItem("generated", "completed"), true);
  assert.equal(EDITABLE_BY_AI.has("approved"), false);
  assert.equal(jobStatusFrom("in_progress"), "in_progress");
  assert.equal(jobStatusFrom("weird"), null);
  assert.ok(NOT_CHARGED.has("nsfw") && !NOT_CHARGED.has("completed"));
});

test("Higgsfield: Key auth + Idempotency-Key on every submit; timeouts are ambiguous, 4xx are not", async () => {
  let seen: { url: string; headers: Record<string, string>; body: unknown } | null = null;
  const ok = (async (url: string, init: RequestInit) => { seen = { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
    return new Response(JSON.stringify({ status: "queued", request_id: "req_1", status_url: "https://api.higgsfield.ai/requests/req_1/status" }), { status: 200 }); }) as unknown as typeof fetch;
  const r = await hfSubmit({ keyId: "kid", secret: "sec", endpoint: "higgsfield-ai/soul/v2/standard", input: { prompt: "p" }, idempotencyKey: "gen:abc", webhookUrl: "https://dall-ai.vercel.app/api/webhooks/higgsfield", fetcher: ok });
  assert.equal(r.request_id, "req_1");
  assert.equal(seen!.headers.Authorization, "Key kid:sec");
  assert.equal(seen!.headers["Idempotency-Key"], "gen:abc");
  assert.match(seen!.url, /^https:\/\/api\.higgsfield\.ai\/higgsfield-ai\/soul\/v2\/standard\?hf_webhook=/);
  await assert.rejects(hfSubmit({ keyId: "k", secret: "s", endpoint: "m", input: {}, idempotencyKey: "x", fetcher: (async () => { throw new Error("timeout"); }) as unknown as typeof fetch }),
    (e: unknown) => e instanceof HfError && e.ambiguous);
  await assert.rejects(hfSubmit({ keyId: "k", secret: "s", endpoint: "m", input: {}, idempotencyKey: "x", fetcher: (async () => new Response("bad prompt", { status: 422 })) as typeof fetch }),
    (e: unknown) => e instanceof HfError && !e.ambiguous && e.status === 422);
  await assert.rejects(hfSubmit({ keyId: "k", secret: "s", endpoint: "../../evil", input: {}, idempotencyKey: "x", fetcher: ok }), /Invalid model endpoint/);
  assert.deepEqual(hfOutputs({ images: [{ url: "https://x/1.png" }], video: { url: "https://x/v.mp4", content_type: "video/mp4" } }).length, 2);
});

test("Higgsfield webhooks: Standard Webhooks signatures verified, tampering and stale timestamps refused", () => {
  const secretRaw = Buffer.from("super-secret-key-bytes");
  const secret = `whsec_${secretRaw.toString("base64")}`;
  const ts = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ request_id: "req_1", status: "completed" });
  const sig = createHmac("sha256", secretRaw).update(`msg_1.${ts}.${body}`).digest("base64");
  assert.equal(verifyHfWebhook({ secret, id: "msg_1", timestamp: ts, signature: `v1,${sig}`, body }), true);
  assert.equal(verifyHfWebhook({ secret, id: "msg_1", timestamp: ts, signature: `v1,bad v1,${sig}`, body }), true);       // any entry may match
  assert.equal(verifyHfWebhook({ secret, id: "msg_1", timestamp: ts, signature: `v1,${sig}`, body: body + " " }), false);
  assert.equal(verifyHfWebhook({ secret, id: "msg_1", timestamp: String(Number(ts) - 600), signature: `v1,${sig}`, body }), false);
  assert.equal(verifyHfWebhook({ secret: "", id: "msg_1", timestamp: ts, signature: `v1,${sig}`, body }), false);
});

import { chooseModel, taskFor } from "../lib/creative/router.ts";
test("router: picks best enabled model for the task, needs image input for edits", () => {
  const ms = [
    { id: "a", endpoint: "openai/gpt-image-2/edit", kind: "image" as const, enabled: true, tasks: ["photo_edit", "product_photo"], image_param: "image_url" },
    { id: "b", endpoint: "marketing-studio/image", kind: "image" as const, enabled: true, tasks: ["product_photo"], image_param: "image_url" },
    { id: "c", endpoint: "openai/gpt-image-2", kind: "image" as const, enabled: true, tasks: ["poster"], image_param: null },
    { id: "v", endpoint: "kling-video/v4.0/image-to-video", kind: "video" as const, enabled: false, tasks: ["animate_photo"], image_param: "image_url" },
  ];
  assert.equal(chooseModel("product_photo", ms)?.model.id, "b");
  assert.equal(chooseModel("poster", ms)?.model.id, "c");
  assert.equal(chooseModel("animate_photo", ms), null);
  assert.equal(taskFor({ format: "reel", hasReference: true }), "animate_photo");
  assert.equal(taskFor({ format: "static_image", hasReference: false, needsText: true }), "poster");
});

import { publishInstagram, publishFacebook, buildCaption, publishTime } from "../lib/social-publish.ts";
test("social: instagram container → wait → publish; facebook photo post; caption + Lagos time", async () => {
  const calls: string[] = [];
  let polls = 0;
  const f = (async (url: string) => {
    calls.push(String(url).replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+/, ""));
    if (String(url).includes("/media_publish")) return new Response(JSON.stringify({ id: "POST1" }));
    if (String(url).includes("/media")) return new Response(JSON.stringify({ id: "C1" }));
    if (String(url).includes("status_code")) return new Response(JSON.stringify({ status_code: ++polls > 1 ? "FINISHED" : "IN_PROGRESS" }));
    if (String(url).includes("/photos")) return new Response(JSON.stringify({ id: "P", post_id: "PAGE_P" }));
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  assert.equal(await publishInstagram({ igUserId: "IG", token: "t", caption: "hi", media: { url: "u", kind: "image" }, fetcher: f, pollMs: 1 }), "POST1");
  assert.deepEqual(calls.map((c) => c.split("?")[0]), ["/IG/media", "/C1", "/C1", "/IG/media_publish"]);
  assert.equal(await publishFacebook({ pageId: "PG", token: "t", caption: "hi", media: { url: "u", kind: "image" }, fetcher: f }), "PAGE_P");
  assert.equal(buildCaption({ caption: "Tasty", cta: "DM to order" }), "Tasty\n\nDM to order");
  assert.equal(publishTime("2026-12-02", 18).toISOString(), "2026-12-02T17:00:00.000Z");
  const denied = (async () => new Response(JSON.stringify({ error: { message: "(#200) Requires pages_manage_posts" } }), { status: 403 })) as typeof fetch;
  await assert.rejects(publishFacebook({ pageId: "PG", token: "t", caption: "x", media: { url: "u", kind: "image" }, fetcher: denied }), /reconnect via Meta/);
});

test("motion video: brief prefills from the profile, asks for what's missing, and the pack only uses real photos", async () => {
  const { prefillMotionBrief, motionQuestions, motionRequest, enforcePack, MotionPack, MOTION_SKILL } = await import("../lib/creative/motion.ts");
  const b = prefillMotionBrief({ industry: "rooftop lounge", audience: "young professionals", objectives: ["bookings"], location: "Lekki", offers: "table booking" }, { one_message: "Sunsets above Lekki" }, "Skyline");
  assert.equal(b.business_type, "rooftop lounge"); assert.equal(b.goal, "bookings"); assert.equal(b.one_message, "Sunsets above Lekki"); assert.equal(b.duration, 15);
  assert.equal(b.kind, "launch");
  const lq = motionQuestions(b, 0);
  assert.ok(lq.some((x) => x.includes("logo")) && lq.some((x) => x.includes("launching")));
  const q = motionQuestions({ ...b, kind: "space" }, 1);
  assert.ok(q[0].includes("at least 3 photos")); assert.ok(q.some((x) => x.includes("features")));
  assert.ok(!/sanji|higgsfield\.ai\/@/i.test(MOTION_SKILL));
  const req = motionRequest({ name: "Skyline", brief: { ...b, launch_what: "Friday brunch" }, profile: {}, photos: ["ws/b/brand/1-roof.jpg"] });
  assert.ok(req.includes("1. ws/b/brand/1-roof.jpg") && req.includes("15 seconds") && req.includes("LAUNCH VIDEO in motion graphics. Launching: Friday brunch"));
  assert.ok(MOTION_SKILL.includes("Kinetic typography"));

  const scene = (beat: string, start: number, end: number, photo: string) => ({ beat, start, end, visual_objective: "o", shot: "s", camera: "slow dolly-in", prompt: "p", source_photo: photo });
  const pack = MotionPack.parse({
    assets: [{ path: "ws/b/brand/1-roof.jpg", role: "hero", assessment: "great light" }, { path: "stock/fake.jpg", role: "hero", assessment: "x" }],
    enhancements: [{ source_path: "stock/fake.jpg", direction: "d", prompt: "p", rank: 1 }, { source_path: "ws/b/brand/1-roof.jpg", direction: "warm grade", prompt: "p", rank: 2 }],
    storyboard: { title: "t", duration: 20, aspect_ratio: "9:16", scenes: [scene("cta", 12, 20, "ws/b/brand/1-roof.jpg"), scene("hook", 0, 4, "ws/b/brand/1-roof.jpg"), scene("space", 4, 12, "invented.jpg")] },
  });
  const launch = enforcePack(pack, ["ws/b/brand/1-roof.jpg"], 15, "launch");
  assert.ok(!launch.needs_from_owner.some((n) => n.includes("no matching photo"))); // graphics-only scenes are fine in a launch video
  const out = enforcePack(pack, ["ws/b/brand/1-roof.jpg"], 15, "space");
  assert.equal(out.assets.length, 1); assert.equal(out.enhancements.length, 1);
  assert.deepEqual(out.storyboard.scenes.map((s) => s.beat), ["hook", "space", "cta"]);
  assert.equal(out.storyboard.scenes[1].source_photo, ""); assert.equal(out.storyboard.scenes[2].end, 15); assert.equal(out.storyboard.duration, 15);
  assert.ok(out.needs_from_owner.some((n) => n.includes("no matching photo")));
});

test("motion generation: photo scenes animate the real photo, graphics scenes use text-to-video, prices add up", async () => {
  const { planMotionGeneration, totalOf } = await import("../lib/creative/motion-gen.ts");
  const { MotionPack } = await import("../lib/creative/motion.ts");
  const m = (id: string, endpoint: string, kind: "image" | "video", tasks: string[], extra: object = {}) => ({ id, endpoint, name: endpoint, kind, unit: kind === "video" ? "second" as const : "image" as const, usd_per_unit: kind === "video" ? 0.1 : 0.05, max_seconds: kind === "video" ? 10 : null, allowed_params: ["prompt", "aspect_ratio", "duration"], enabled: true, tasks, ...extra });
  const models = [m("e", "openai/gpt-image-2/edit", "image", ["photo_edit"], { image_param: "image_url" }), m("a", "kling-video/v4.0/image-to-video", "video", ["animate_photo"], { image_param: "image_url" }), m("t", "bytedance/seedance-2.0/text-to-video", "video", ["video_ad"])];
  const pack = MotionPack.parse({
    enhancements: [{ source_path: "p/1.jpg", direction: "warm grade", prompt: "grade it", keep_unchanged: "signage", crops: ["4:5"], rank: 1 }],
    storyboard: { title: "Launch", duration: 15, aspect_ratio: "9:16", scenes: [
      { beat: "hook", start: 0, end: 3, visual_objective: "o", shot: "s", camera: "slow push-in", motion: "words land one by one", prompt: "kinetic type", source_photo: "" },
      { beat: "space", start: 3, end: 15, visual_objective: "o", shot: "s", camera: "dolly-in", prompt: "the new branch", source_photo: "p/1.jpg" },
      { beat: "cta", start: 15, end: 15, visual_objective: "o", shot: "s", camera: "drift", prompt: "logo", source_photo: "" },
    ] },
  });
  const { lines, problems } = planMotionGeneration(pack, models);
  assert.deepEqual(problems, []);
  assert.deepEqual(lines.map((l) => [l.key, l.task, l.model.id]), [["edit:0", "photo_edit", "e"], ["scene:0", "video_ad", "t"], ["scene:1", "animate_photo", "a"], ["scene:2", "video_ad", "t"]]);
  assert.ok(lines[0].spec.prompt.includes("Keep exactly as in the photo: signage") && lines[0].spec.aspect_ratio === "4:5");
  assert.ok(lines[1].spec.prompt.includes("Motion: words land one by one") && lines[1].spec.reference_asset_paths.length === 0);
  assert.equal(lines[2].spec.duration_seconds, 10); // clamped to the model's max
  assert.equal(lines[3].spec.duration_seconds, 2); // every clip is at least 2 seconds
  assert.equal(totalOf(lines), Math.round((0.05 + 0.3 + 1 + 0.2) * 1e6) / 1e6);
  const none = planMotionGeneration(pack, []);
  assert.equal(none.lines.length, 0); assert.ok(none.problems[0].includes("no edit my photo model is enabled"));
});
