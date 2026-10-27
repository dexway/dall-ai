// Marketing API helpers for managing campaigns after launch: status, budget, schedule, ad text,
// state sync and daily insights. Pure (fetch is injectable) so tests can run without Meta.

const graph = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v26.0"}`;

export class MetaApiError extends Error {
  status: number; raw: string;
  constructor(what: string, status: number, raw: string) { super(`${what} failed ${status}: ${raw.slice(0, 300)}`); this.status = status; this.raw = raw; }
}

async function call(what: string, method: "GET" | "POST", path: string, token: string, body?: Record<string, unknown>, fetcher: typeof fetch = fetch) {
  const url = new URL(`${graph()}/${path}`);
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) } };
  if (body) init.body = JSON.stringify(body);
  const res = await fetcher(url.toString(), init);
  const text = await res.text();
  if (!res.ok) throw new MetaApiError(what, res.status, text);
  return (text ? JSON.parse(text) : {}) as Record<string, unknown>;
}

export type MetaIds = { campaignId: string; adsetId?: string | null; adId?: string | null };

/**
 * Pausing stops the campaign (enough on its own). Resuming switches campaign, ad set and ad on,
 * because Meta only delivers when all three are ACTIVE. Callers must have the owner's explicit yes.
 */
export async function setDelivery(token: string, ids: MetaIds, to: "ACTIVE" | "PAUSED", fetcher?: typeof fetch) {
  if (to === "PAUSED") {
    await call("pause campaign", "POST", ids.campaignId, token, { status: "PAUSED" }, fetcher);
    return;
  }
  if (ids.adId) await call("activate ad", "POST", ids.adId, token, { status: "ACTIVE" }, fetcher);
  if (ids.adsetId) await call("activate ad set", "POST", ids.adsetId, token, { status: "ACTIVE" }, fetcher);
  await call("activate campaign", "POST", ids.campaignId, token, { status: "ACTIVE" }, fetcher);
}

/** Daily budget and optional schedule on the ad set. Times are ISO strings; null clears the end date. */
export async function updateAdSet(token: string, adsetId: string, patch: { dailyBudgetMinor?: number; endTime?: string | null; startTime?: string }, fetcher?: typeof fetch) {
  const body: Record<string, unknown> = {};
  if (patch.dailyBudgetMinor !== undefined) body.daily_budget = patch.dailyBudgetMinor;
  if (patch.startTime) body.start_time = patch.startTime;
  if (patch.endTime !== undefined) body.end_time = patch.endTime ?? 0;
  if (!Object.keys(body).length) return;
  await call("update ad set", "POST", adsetId, token, body, fetcher);
}

/**
 * Creatives can't be edited in place: copy the current one with new text/headline and point the ad at it.
 */
export async function updateAdText(token: string, adAccountId: string, adId: string, patch: { message?: string; headline?: string }, fetcher?: typeof fetch): Promise<string> {
  const ad = await call("read ad", "GET", `${adId}?fields=creative{id,name,object_story_spec}`, token, undefined, fetcher);
  const creative = ad.creative as { id: string; name?: string; object_story_spec?: { page_id: string; link_data?: Record<string, unknown> } } | undefined;
  const spec = creative?.object_story_spec;
  if (!spec?.link_data) throw new MetaApiError("read creative", 422, "This ad's creative can't be edited from Dall AI.");
  const link_data = { ...spec.link_data };
  if (patch.message) link_data.message = patch.message;
  if (patch.headline) link_data.name = patch.headline.slice(0, 40);
  delete (link_data as Record<string, unknown>).picture; // image_hash stays; picture URLs can't be reused
  const created = await call("create creative", "POST", `${adAccountId}/adcreatives`, token, {
    name: `${creative?.name ?? "Dall AI"} · edited ${new Date().toISOString().slice(0, 10)}`,
    object_story_spec: { page_id: spec.page_id, link_data },
  }, fetcher);
  await call("update ad creative", "POST", adId, token, { creative: { creative_id: String(created.id) } }, fetcher);
  return String(created.id);
}

export async function campaignState(token: string, campaignId: string, fetcher?: typeof fetch): Promise<{ status?: string; effective_status?: string; name?: string }> {
  return call("read campaign", "GET", `${campaignId}?fields=status,effective_status,name`, token, undefined, fetcher) as Promise<{ status?: string; effective_status?: string; name?: string }>;
}

export type DailyInsight = { day: string; spend_minor: number; impressions: number; reach: number; clicks: number; conversations_started: number; leads: number };

const CONV_ACTIONS = ["onsite_conversion.messaging_conversation_started_7d", "messaging_conversation_started_7d"];
const LEAD_ACTIONS = ["lead", "onsite_conversion.lead_grouped", "leadgen_grouped"];

/** Parses one Meta insights row. Spend comes as a decimal string in the account currency. */
export function parseInsightRow(r: { date_start?: string; spend?: string; impressions?: string; reach?: string; clicks?: string; actions?: { action_type: string; value: string }[] }, minorPerUnit = 100): DailyInsight {
  const act = (types: string[]) => (r.actions ?? []).filter((a) => types.includes(a.action_type)).reduce((s, a) => s + Number(a.value || 0), 0);
  return {
    day: r.date_start ?? "",
    spend_minor: Math.round(Number(r.spend ?? 0) * minorPerUnit),
    impressions: Number(r.impressions ?? 0), reach: Number(r.reach ?? 0), clicks: Number(r.clicks ?? 0),
    conversations_started: act(CONV_ACTIONS), leads: act(LEAD_ACTIONS),
  };
}

/** Day-by-day insights between two dates (YYYY-MM-DD), following Meta's paging. */
export async function dailyInsights(token: string, campaignId: string, since: string, until: string, fetcher?: typeof fetch): Promise<DailyInsight[]> {
  const out: DailyInsight[] = [];
  let path: string | null = `${campaignId}/insights?fields=spend,impressions,reach,clicks,actions&time_increment=1&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&limit=100`;
  for (let page = 0; path && page < 10; page++) {
    const j = await call("read insights", "GET", path, token, undefined, fetcher) as { data?: Parameters<typeof parseInsightRow>[0][]; paging?: { next?: string } };
    out.push(...(j.data ?? []).map((r) => parseInsightRow(r)));
    path = j.paging?.next ? j.paging.next.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+\//, "") : null;
  }
  return out;
}

/** Validates an edit before it reaches Meta. Returns a plain-English problem or null. */
export function validateAdEdit(e: { dailyBudgetMinor?: number; currency: string; endTime?: string | null; message?: string; headline?: string }, now = Date.now()): string | null {
  if (e.dailyBudgetMinor !== undefined) {
    if (!Number.isFinite(e.dailyBudgetMinor) || e.dailyBudgetMinor <= 0) return "The daily budget must be more than zero.";
    if (e.currency === "NGN" && e.dailyBudgetMinor < 150_000) return "Meta needs at least ₦1,500 a day for message ads to deliver.";
    if (e.currency === "USD" && e.dailyBudgetMinor < 100) return "Meta needs at least $1 a day.";
  }
  if (e.endTime) {
    const t = Date.parse(e.endTime);
    if (Number.isNaN(t)) return "That end date isn't valid.";
    if (t < now + 3600_000) return "The end date must be at least an hour from now.";
  }
  if (e.message !== undefined && (e.message.trim().length < 5 || e.message.length > 600)) return "Ad text must be between 5 and 600 characters.";
  if (e.headline !== undefined && e.headline.length > 40) return "Headlines can be at most 40 characters.";
  return null;
}
