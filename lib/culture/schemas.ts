// Creative Studio's cultural intelligence: the shapes each agent returns and the deterministic checks
// the Evidence Verifier and Knowledge Archivist run. No AI and no database here, so it's testable.
import { z } from "zod";

/** The progress stages a research task moves through (shown to the owner as it runs). */
export const STAGES = [
  ["understand", "Understanding your business and offer"],
  ["assign", "Assigning the cultural research task"],
  ["memory", "Searching the cultural knowledge base"],
  ["investigate", "Investigating current and historical references"],
  ["verify", "Checking sources and dates"],
  ["opportunities", "Identifying advertising opportunities"],
  ["archive", "Saving findings for review"],
] as const;
export type Stage = (typeof STAGES)[number][0];

export const DEPTH_SEARCHES = { quick: 0, standard: 6, deep: 14 } as const;
export type Depth = keyof typeof DEPTH_SEARCHES;

/** Platforms whose terms forbid unapproved automated collection. Never used as evidence. */
export const BLOCKED_DOMAINS = ["instagram.com", "facebook.com", "fb.com", "tiktok.com", "threads.net", "x.com", "twitter.com", "whatsapp.com"];

const conf = z.enum(["high", "medium", "low"]).catch("low");
const str = (max: number) => z.string().trim().max(max).catch("");

/** One piece of cultural knowledge, as the Cultural Analyst describes it. Shared, so no business data. */
export const Insight = z.object({
  title: z.string().trim().min(2).max(120),
  meaning: z.string().trim().min(5).max(800),
  kind: z.enum(["slang", "situation", "reference", "trend", "history", "humour", "custom"]).catch("situation"),
  lifespan: z.enum(["evergreen", "recurring", "trending", "historical"]).catch("recurring"),
  region: str(80),
  audience: str(200),
  why_relatable: str(500),
  example: str(300),
  usage_note: str(300),
  confidence: conf,
  sources: z.array(z.object({ url: z.string().trim().max(500), excerpt: str(400) })).max(6).default([]),
});
export type Insight = z.infer<typeof Insight>;

/** An advertising angle for this business. Private: stays on the business's own task. */
export const Opportunity = z.object({
  title: z.string().trim().min(2).max(140),
  angle: z.string().trim().min(5).max(700),
  product: str(160),
  uses: z.array(z.string().trim().max(120)).max(6).default([]), // insight titles it builds on
  format: str(80),
  risk: str(300),
});

export const ResearchResult = z.object({
  summary: z.string().trim().max(1500).catch(""),
  insights: z.array(Insight).max(16).default([]),
  opportunities: z.array(Opportunity).max(8).default([]),
  limitations: z.array(z.string().trim().max(300)).max(8).default([]),
});
export type ResearchResult = z.infer<typeof ResearchResult>;

export const RESULT_SCHEMA = `{"summary","insights":[{"title","meaning","kind":"slang|situation|reference|trend|history|humour|custom","lifespan":"evergreen|recurring|trending|historical","region","audience","why_relatable","example","usage_note","confidence":"high|medium|low","sources":[{"url","excerpt"}]}],"opportunities":[{"title","angle","product","uses":[insight title],"format","risk"}],"limitations":[string]}`;

/** One title, one key: lowercased, accents and punctuation removed, so "NEPA Don Take Light!" and "nepa don take light" match. */
export function knowledgeKey(title: string): string {
  return title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120);
}

export function hostOf(u: string): string | null {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}
const under = (host: string, d: string) => host === d || host.endsWith("." + d);

/**
 * Evidence Verifier: a source counts only if the search tools actually returned it, it isn't a
 * blocked platform and it isn't a source the admin disallowed. Insights left without a source are
 * kept as low-confidence hypotheses (never trusted automatically).
 */
export function verifyEvidence(r: ResearchResult, seen: Set<string>, disallowed: string[] = []): { result: ResearchResult; rejected: { url: string; reason: string }[] } {
  const rejected: { url: string; reason: string }[] = [];
  const bad = [...BLOCKED_DOMAINS, ...disallowed.map((d) => d.toLowerCase().replace(/^www\./, ""))];
  const insights = r.insights.map((i) => {
    const sources = i.sources.filter((s) => {
      const host = hostOf(s.url);
      if (!host) { rejected.push({ url: s.url, reason: "not a web address" }); return false; }
      if (bad.some((d) => under(host, d))) { rejected.push({ url: s.url, reason: "source not permitted" }); return false; }
      if (!seen.has(normUrl(s.url))) { rejected.push({ url: s.url, reason: "not returned by the search" }); return false; }
      return true;
    });
    return { ...i, sources, confidence: sources.length ? i.confidence : ("low" as const) };
  });
  return { result: { ...r, insights }, rejected };
}

export function normUrl(u: string): string {
  try { const x = new URL(u); x.hash = ""; return `${x.protocol}//${x.hostname.toLowerCase().replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}${x.search}`; } catch { return u.trim(); }
}

/** How long before a knowledge record needs checking again, by how fast that kind of culture changes. */
export function refreshDue(lifespan: Insight["lifespan"], from = new Date()): Date | null {
  const days = { evergreen: 90, recurring: 30, trending: 7, historical: null }[lifespan];
  return days == null ? null : new Date(from.getTime() + days * 86_400_000);
}

/**
 * Knowledge Archivist: drops duplicates within one result and decides, per insight, whether it's a
 * new record or a new version of an existing key. Existing pending records are not duplicated.
 */
export function planArchive(insights: Insight[], existing: { key: string; version: number; status: string }[]): { insight: Insight; key: string; version: number }[] {
  const latest = new Map<string, { version: number; status: string }>();
  for (const e of existing) if (!latest.has(e.key) || latest.get(e.key)!.version < e.version) latest.set(e.key, e);
  const out: { insight: Insight; key: string; version: number }[] = [];
  const seen = new Set<string>();
  for (const i of insights) {
    const key = knowledgeKey(i.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const cur = latest.get(key);
    if (cur?.status === "pending_review") continue; // already waiting for review
    out.push({ insight: i, key, version: (cur?.version ?? 0) + 1 });
  }
  return out;
}

/** Words worth matching on in the knowledge base ("funny Lagos relationship situations" → lagos, relationship, ...). */
export function topicTerms(topic: string): string[] {
  const stop = new Set(["the", "and", "for", "that", "with", "about", "from", "into", "this", "what", "funny", "could", "help", "sell", "our", "your", "their", "some", "research", "find", "make", "want", "nigerian", "nigeria"]);
  return [...new Set(topic.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !stop.has(w)))].slice(0, 8);
}
