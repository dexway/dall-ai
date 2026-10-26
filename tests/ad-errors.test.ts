import { test } from "node:test";
import assert from "node:assert/strict";
import { explainAdError, parseStoredFailure } from "../lib/ad-errors.ts";

const meta = (o: object) => `adsets create failed 400: ${JSON.stringify({ error: o })}`;

test("bid-strategy and budget-sharing rejections are flagged as our bug, not the owner's", () => {
  const a = explainAdError("adset", meta({ message: "Invalid parameter", code: 100, error_subcode: 2490487, error_user_title: "Bid amount or bid constraints required for bid strategy" }));
  assert.equal(a.ourBug, true);
  assert.equal(a.title, "Bid amount or bid constraints required for bid strategy");
  const b = parseStoredFailure(`campaigns create failed 400: ${JSON.stringify({ error: { message: "Invalid parameter", code: 100, error_subcode: 4834011 } })}`);
  assert.equal(b?.step, "campaign");
  assert.equal(b?.ourBug, true);
});

test("permission, expired token, WhatsApp link and budget problems give owner-actionable fixes", () => {
  assert.match(explainAdError("campaign", meta({ code: 200, message: "Requires ads_management permission" })).fix, /Refresh permissions/);
  assert.equal(explainAdError("ad", meta({ code: 190, message: "Error validating access token" })).title, "Facebook access expired");
  assert.match(explainAdError("adset", meta({ code: 100, message: "Invalid parameter", error_user_msg: "The Page must have a WhatsApp number linked" })).fix, /WhatsApp accounts/);
  assert.match(explainAdError("adset", meta({ code: 100, error_user_msg: "Your budget is too low. The minimum is ₦1,500" })).title, /minimum/);
});

test("stored JSON failures round-trip and unknown text still produces a readable failure", () => {
  const f = explainAdError("creative", "network down");
  assert.deepEqual(parseStoredFailure(JSON.stringify(f)), JSON.parse(JSON.stringify(f)));
  assert.equal(parseStoredFailure(null), null);
  assert.ok(parseStoredFailure("something odd")?.fix);
});
