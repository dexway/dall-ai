// Validated shapes for everything the Creative Director produces. AI output is parsed against these
// before it is saved or sent to a generation API; anything that doesn't fit is rejected, not guessed.
import { z } from "zod";

const str = (max: number) => z.string().trim().min(1).max(max);
const opt = (max: number) => z.string().trim().max(max).optional().default("");

export const BrandProfile = z.object({
  website: opt(300), industry: opt(120), location: opt(120),
  products: opt(2000), audience: opt(1500), problems: opt(1500),
  objectives: z.array(z.enum(["awareness", "engagement", "leads", "bookings", "sales", "retention", "other"])).default([]),
  offers: opt(1500), differentiators: opt(1500), promotions: opt(800),
  voice: opt(600), language: opt(120), tone: opt(300),
  platforms: z.array(z.enum(["instagram", "tiktok", "facebook", "x", "linkedin", "youtube", "whatsapp"])).default([]),
  frequency: opt(120), campaign_start: opt(20), campaign_end: opt(20),
  restrictions: opt(1500), prohibited_claims: opt(1500),
});
export type BrandProfile = z.infer<typeof BrandProfile>;

/** Fields whose absence materially weakens research or strategy, in plain words. */
export function missingBrief(p: Partial<BrandProfile>, accounts: { kind: string; accepted: boolean }[]): string[] {
  const out: string[] = [];
  if (!p.industry) out.push("Industry");
  if (!p.products) out.push("What you sell");
  if (!p.audience) out.push("Who your customers are");
  if (!p.objectives?.length) out.push("Business goals");
  if (!p.platforms?.length) out.push("Which platforms you post on");
  const comp = accounts.filter((a) => a.kind === "competitor" && a.accepted).length;
  const insp = accounts.filter((a) => a.kind === "inspiration" && a.accepted).length;
  if (comp < 3) out.push(`At least 3 direct competitors (you have ${comp})`);
  if (insp < 3) out.push(`At least 3 inspiration accounts (you have ${insp})`);
  return out;
}

const SourceRefs = z.array(z.string().url()).max(12).default([]);
const Confidence = z.enum(["high", "medium", "low"]);
const Claim = z.object({ text: str(700), sources: SourceRefs, confidence: Confidence.default("medium") });

export const ResearchReport = z.object({
  overview: Claim,
  competitors: z.array(z.object({
    name: str(120), handle_or_url: opt(300), positioning: opt(500), formats: z.array(str(80)).max(8).default([]),
    themes: z.array(str(120)).max(8).default([]), strengths: z.array(str(240)).max(6).default([]), weaknesses: z.array(str(240)).max(6).default([]),
    observed_cadence: opt(160), sources: SourceRefs, confidence: Confidence.default("medium"),
  })).max(12).default([]),
  format_analysis: z.array(Claim).max(8).default([]),
  audience_needs: z.array(Claim).max(8).default([]),
  trends: z.array(Claim.extend({ date: opt(40) })).max(8).default([]),
  content_gaps: z.array(Claim).max(8).default([]),
  overused: z.array(Claim).max(6).default([]),
  positioning: Claim,
  experiments: z.array(z.object({ idea: str(300), hypothesis: str(300), measure: str(200) })).max(8).default([]),
  limitations: z.array(str(300)).max(10).default([]),
});
export type ResearchReport = z.infer<typeof ResearchReport>;

/**
 * Drops any citation to a URL the research tools never returned, and downgrades claims left with no
 * source to "low" confidence so the UI shows them as hypotheses, not findings.
 */
export function enforceSources(r: ResearchReport, known: Set<string>): { report: ResearchReport; dropped: number } {
  let dropped = 0;
  const fix = <T extends { sources: string[]; confidence: "high" | "medium" | "low" }>(c: T): T => {
    const kept = c.sources.filter((u) => known.has(normalizeUrl(u)));
    dropped += c.sources.length - kept.length;
    return { ...c, sources: kept, confidence: kept.length ? c.confidence : "low" };
  };
  const report = {
    ...r,
    overview: fix(r.overview), positioning: fix(r.positioning),
    competitors: r.competitors.map(fix), format_analysis: r.format_analysis.map(fix), audience_needs: r.audience_needs.map(fix),
    trends: r.trends.map(fix), content_gaps: r.content_gaps.map(fix), overused: r.overused.map(fix),
  };
  return { report, dropped }; // count after every claim has been filtered
}

export function normalizeUrl(u: string): string {
  try { const x = new URL(u); x.hash = ""; return x.toString().replace(/\/$/, ""); } catch { return u; }
}

export const Idea = z.object({
  objective: str(240), audience: str(240), insight: str(500), hook: str(240), execution: str(900),
  why_now: str(400), differentiation: str(400), action: str(200), production: str(500),
  evidence: z.object({ kind: z.enum(["research", "hypothesis"]), note: str(400), sources: SourceRefs }),
  measure: str(240),
  caption: opt(2200), cta: opt(160), visual_direction: opt(700),
  shots: z.array(z.object({ seconds: z.number().min(0).max(120).optional(), description: str(300) })).max(12).default([]),
  production_method: z.enum(["ai_image", "ai_video", "photo_shoot", "video_shoot", "graphic_design", "ugc", "mixed"]).default("mixed"),
});
export type Idea = z.infer<typeof Idea>;

export const Strategy = z.object({
  summary: str(700),
  positioning: str(700),
  segments: z.array(z.object({ name: str(80), description: str(400) })).min(1).max(6),
  pillars: z.array(z.object({ name: str(60), purpose: str(300), share_pct: z.number().min(0).max(100) })).min(2).max(6),
  creative_direction: str(900),
  visual_language: str(700),
  tone: str(400),
  themes: z.array(str(160)).min(1).max(8),
  formats: z.array(z.object({ platform: str(40), role: str(200), formats: z.array(str(60)).max(6) })).min(1).max(7),
  cadence: str(300),
  conversion_goals: z.array(str(200)).min(1).max(6),
  measurement: z.array(z.object({ metric: str(80), why: str(200) })).min(1).max(8),
  research_links: z.array(z.object({ decision: str(240), because: str(300), sources: SourceRefs })).max(10).default([]),
  rejected_ideas: z.array(z.object({ idea: str(200), why_rejected: str(240) })).max(6).default([]),
});
export type Strategy = z.infer<typeof Strategy>;

export const PLATFORMS = ["instagram", "tiktok", "facebook", "x", "linkedin", "youtube", "whatsapp"] as const;
export const FORMATS = ["static_image", "carousel", "reel", "short_video", "story", "long_video", "text_post", "product_campaign", "educational", "testimonial", "promotion", "live"] as const;

export const CalendarItem = z.object({
  planned_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  platform: z.enum(PLATFORMS),
  format: z.enum(FORMATS),
  pillar: str(60), campaign: opt(120),
  idea: Idea,
});
export const Calendar = z.object({ items: z.array(CalendarItem).min(1).max(40) });
export type CalendarItem = z.infer<typeof CalendarItem>;

export const ProductionSpec = z.object({
  objective: str(300),
  prompt: str(2500),
  negative: opt(800),
  aspect_ratio: z.enum(["1:1", "4:5", "9:16", "16:9", "3:4", "4:3"]),
  duration_seconds: z.number().int().min(1).max(60).optional(),
  resolution: opt(20),
  reference_asset_paths: z.array(z.string().max(400)).max(6).default([]),
  variations: z.number().int().min(1).max(4).default(1),
  output: z.enum(["image", "video"]),
  scenes: z.array(z.object({ seconds: z.number().min(0).max(60), prompt: str(800) })).max(8).default([]),
});
export type ProductionSpec = z.infer<typeof ProductionSpec>;

export const AccountSuggestions = z.object({
  accounts: z.array(z.object({ kind: z.enum(["competitor", "inspiration", "leader"]), platform: opt(40), handle_or_url: str(300), why: str(300), sources: SourceRefs })).max(15),
});

/** Pulls the first JSON object out of model text and validates it. */
export function parseJson<T>(schema: z.ZodType<T>, text: string): { ok: true; value: T } | { ok: false; error: string } {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, error: "No JSON object in the reply." };
  let raw: unknown;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch (e) { return { ok: false, error: `Invalid JSON: ${(e as Error).message.slice(0, 120)}` }; }
  const r = schema.safeParse(raw);
  if (!r.success) return { ok: false, error: r.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { ok: true, value: r.data };
}
