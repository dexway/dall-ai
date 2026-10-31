// Creative Studio cultural intelligence: evidence verification, archiving and freshness (no AI, no DB).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ResearchResult, verifyEvidence, planArchive, knowledgeKey, refreshDue, topicTerms, normUrl } from "../lib/culture/schemas.ts";

const raw = ResearchResult.parse({
  summary: "s",
  insights: [
    { title: "NEPA don take light!", meaning: "The shout when power goes off mid-activity.", kind: "situation", lifespan: "evergreen", confidence: "high",
      sources: [{ url: "https://www.pulse.ng/lifestyle/nepa?x=1", excerpt: "e" }, { url: "https://www.instagram.com/p/abc", excerpt: "e" }, { url: "https://made-up.ng/a", excerpt: "e" }] },
    { title: "Japa", meaning: "Leaving Nigeria to live abroad.", kind: "slang", lifespan: "trending", confidence: "high", sources: [{ url: "https://bad.ng/x", excerpt: "e" }] },
    { title: "nepa don take light", meaning: "duplicate", kind: "situation", lifespan: "evergreen" },
  ],
  opportunities: [{ title: "Generator-free dinner", angle: "Our restaurant never goes dark", uses: ["NEPA don take light!"] }],
});

test("culture: only sources the search returned, never blocked platforms or disallowed domains", () => {
  const { result, rejected } = verifyEvidence(raw, new Set([normUrl("https://pulse.ng/lifestyle/nepa/?x=1"), normUrl("https://bad.ng/x")]), ["bad.ng"]);
  assert.deepEqual(result.insights[0].sources.map((s) => s.url), ["https://www.pulse.ng/lifestyle/nepa?x=1"]);
  assert.equal(result.insights[0].confidence, "high");
  assert.equal(result.insights[1].sources.length, 0);
  assert.equal(result.insights[1].confidence, "low"); // unsourced = hypothesis
  assert.deepEqual(rejected.map((r) => r.reason).sort(), ["not returned by the search", "source not permitted", "source not permitted"]);
});

test("culture: archivist dedupes and versions, and doesn't stack pending reviews", () => {
  assert.equal(knowledgeKey("NEPA don take light!"), knowledgeKey("nepa  don take light"));
  const plan = planArchive(raw.insights, [{ key: "japa", version: 2, status: "trusted" }]);
  assert.deepEqual(plan.map((p) => [p.key, p.version]), [["nepa don take light", 1], ["japa", 3]]);
  assert.equal(planArchive(raw.insights, [{ key: "japa", version: 1, status: "pending_review" }]).length, 1);
});

test("culture: refresh by lifespan; topic terms skip filler", () => {
  const t0 = new Date("2026-01-01T00:00:00Z");
  assert.equal(refreshDue("trending", t0)!.toISOString().slice(0, 10), "2026-01-08");
  assert.equal(refreshDue("historical", t0), null);
  assert.deepEqual(topicTerms("Funny Lagos relationship situations that could sell our couples' dinner"), ["lagos", "relationship", "situations", "couples'", "dinner"]);
});
