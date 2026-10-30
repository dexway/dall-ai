// Free competitor discovery from OpenStreetMap, Harvey's default discovery source ("OpenStreetMap,
// free, unlimited, no account"). From the business type Dall AI already has, find the same kind of
// business in the same area. No AI call, no key. Map data © OpenStreetMap contributors (ODbL).
import { fetchPublic } from "../net-guard.ts";

/** OpenStreetMap tags for the business types Dall AI customers sign up with. */
const CATEGORIES: [RegExp, string[], string][] = [
  [/hotel|resort|suites?|inn\b|lodg|short[- ]?let|apartment|guest ?house|hospitality/i, ['"tourism"~"^(hotel|guest_house|apartment|motel)$"'], "hotel"],
  [/restaurant|eatery|kitchen|food|grill|buka|catering|caterer|chops/i, ['"amenity"="restaurant"', '"amenity"="fast_food"'], "restaurant"],
  [/caf[eé]|coffee|bakery|pastr/i, ['"amenity"="cafe"', '"shop"="bakery"'], "cafe"],
  [/lounge|bar\b|club|night|pub/i, ['"amenity"~"^(bar|pub|nightclub)$"'], "lounge"],
  [/salon|hair|barb|nail|beauty|spa|makeup|lash/i, ['"shop"~"^(hairdresser|beauty|cosmetics)$"', '"leisure"="spa"'], "salon"],
  [/gym|fitness|yoga|pilates|crossfit/i, ['"leisure"="fitness_centre"'], "gym"],
  [/clinic|hospital|dental|dentist|doctor|medical|diagnostic|lab\b|pharm/i, ['"amenity"~"^(clinic|hospital|doctors|dentist|pharmacy)$"'], "clinic"],
  [/event|venue|hall|conference|wedding/i, ['"amenity"~"^(events_venue|conference_centre)$"'], "event centre"],
  [/school|academy|tutor|creche|nursery/i, ['"amenity"~"^(school|kindergarten|college)$"'], "school"],
  [/fashion|boutique|clothing|tailor|fabric|shoe/i, ['"shop"~"^(clothes|boutique|shoes|tailor|fabric)$"'], "boutique"],
  [/supermarket|grocery|mart\b|store/i, ['"shop"~"^(supermarket|convenience)$"'], "supermarket"],
  [/real ?estate|property|realtor/i, ['"office"="estate_agent"'], "real estate agent"],
  [/travel|tour|visa/i, ['"shop"="travel_agency"', '"office"="travel_agent"'], "travel agency"],
  [/car ?wash|auto|mechanic|car dealer/i, ['"amenity"="car_wash"', '"shop"~"^(car|car_repair)$"'], "car wash"],
  [/laundry|dry ?clean/i, ['"shop"~"^(laundry|dry_cleaning)$"'], "laundry"],
  [/phone|gadget|electronic/i, ['"shop"~"^(mobile_phone|electronics|computer)$"'], "phone shop"],
];

export function osmFilters(businessType: string): string[] {
  return CATEGORIES.find(([re]) => re.test(businessType))?.[1] ?? [];
}
/** The search word for the business type ("hotel", "salon"), or "" when it has no map category. */
export function osmNoun(businessType: string): string {
  return CATEGORIES.find(([re]) => re.test(businessType))?.[2] ?? "";
}

type NominatimHit = { name?: string; category?: string; type?: string; importance?: number; extratags?: Record<string, string> | null; address?: Record<string, string> };

/**
 * Nominatim results as places, the obvious ones first. Popularity comes from Nominatim's own order (how
 * high a place appears in any search) plus its importance; duplicate records of one place (the hotel and
 * its building) are merged so a website on either counts. The business itself is left out.
 */
export function nominatimPlaces(lists: NominatimHit[][], self: { name: string; domain: string | null }, limit = 8): OsmPlace[] {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const merged = new Map<string, { tags: Record<string, string>; bonus: number }>();
  for (const hits of lists) hits.forEach((h, i) => {
    if (!h.name || ["boundary", "place", "highway", "landuse"].includes(h.category ?? "")) return;
    const key = norm(h.name), cur = merged.get(key);
    const tags: Record<string, string> = { name: h.name, ...(h.extratags ?? {}), ...(h.address?.suburb ? { "addr:suburb": h.address.suburb } : {}) };
    const bonus = Math.max(0, 90 - i * 5) + Math.round((h.importance ?? 0) * 100); // Nominatim's order is the best popularity signal OSM has
    merged.set(key, { tags: { ...tags, ...(cur?.tags ?? {}), ...(tags.website ? { website: tags.website } : {}) }, bonus: Math.max(bonus, cur?.bonus ?? 0) });
  });
  const els = [...merged.values()];
  const ranked = rankPlaces(els, self, Number.MAX_SAFE_INTEGER);
  const bonus = new Map(els.map((e) => [e.tags.name, e.bonus]));
  return ranked.map((p) => ({ ...p, score: p.score + (bonus.get(p.name) ?? 0) })).sort((a, b) => b.score - a.score).slice(0, limit);
}

export function overpassQuery(filters: string[], bbox: [number, number, number, number], limit = 80): string {
  const b = bbox.join(",");
  return `[out:json][timeout:25];(${filters.map((f) => `nwr[${f}]["name"](${b});`).join("")});out center tags ${limit};`;
}

export type OsmPlace = { name: string; website: string | null; phone: string | null; area: string; notable: boolean; score: number };

/** Ranks places: well-known (Wikidata, a brand), with a website and phone first; drops the business itself. */
export function rankPlaces(elements: { tags?: Record<string, string> }[], self: { name: string; domain: string | null }, limit = 8): OsmPlace[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const me = norm(self.name);
  const seen = new Set<string>();
  const out: OsmPlace[] = [];
  for (const e of elements) {
    const t = e.tags ?? {};
    const name = (t.name ?? "").trim();
    const key = norm(name);
    if (!name || seen.has(key) || (me.length >= 4 && (key.includes(me) || me.includes(key)))) continue;
    const website = t.website || t["contact:website"] || t.url || null;
    if (self.domain && website && website.includes(self.domain)) continue;
    seen.add(key);
    const notable = Boolean(t.wikidata || t.brand || t["brand:wikidata"]);
    const score = (notable ? 50 : 0) + (website ? 25 : 0) + (t.phone || t["contact:phone"] ? 10 : 0) + (t.stars ? Number(t.stars) * 3 || 0 : 0) + (t.operator ? 5 : 0) + (t["addr:street"] ? 3 : 0);
    out.push({ name, website, phone: t.phone || t["contact:phone"] || null, area: t["addr:suburb"] || t["addr:city"] || t["is_in"] || "", notable, score });
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}

const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
const UA = "DallAI-bot/1.0"; // Overpass refuses user agents that contain a URL

/** Bounding box for an area ("Lekki, Lagos"), falling back to Lagos. */
export async function geocode(area: string): Promise<[number, number, number, number]> {
  const q = /nigeria/i.test(area) ? area : `${area || "Lagos"}, Nigeria`;
  try {
    const r = await fetchPublic(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, 200_000, { "User-Agent": UA });
    const j = JSON.parse(r.bytes.toString("utf8")) as { boundingbox?: string[] }[];
    const bb = j[0]?.boundingbox?.map(Number);
    if (bb && bb.length === 4 && bb.every(Number.isFinite)) {
      // Nominatim gives [south, north, west, east]; Overpass wants (south, west, north, east). Widen tiny areas a little.
      const [s, n, w, e] = bb, pad = Math.max(0, 0.04 - (n - s)) / 2;
      return [s - pad, w - pad, n + pad, e + pad];
    }
  } catch { /* fall back to Lagos */ }
  return [6.39, 3.25, 6.62, 3.65];
}

/** The obvious competitors near a business, from OpenStreetMap. Empty when the type has no map category. */
export async function findCompetitorsOsm(a: { businessType: string; area: string; name: string; domain: string | null }, limit = 8): Promise<OsmPlace[]> {
  const filters = osmFilters(a.businessType), noun = osmNoun(a.businessType);
  if (!filters.length) return [];
  // 1. Nominatim search ("hotel Victoria Island Lagos"): fast, and ranks well-known places first.
  const area = a.area || "Lagos";
  const lists: NominatimHit[][] = [];
  // "Lagos" alone is too broad for one search: also look in the main business districts.
  const areas = /^\s*lagos(,?\s*nigeria)?\s*$/i.test(area) ? ["Victoria Island Lagos", "Ikoyi Lagos", "Lekki Lagos", "Ikeja Lagos"] : [/lagos|abuja|port harcourt|ibadan|kano|enugu|benin/i.test(area) ? area : `${area} Lagos`];
  for (const q of areas.map((x) => `${noun} ${x}`)) {
    try {
      const r = await fetchPublic(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=40&extratags=1&addressdetails=1&countrycodes=ng&q=${encodeURIComponent(q)}`, 1_000_000, { "User-Agent": UA }, 15_000);
      lists.push(JSON.parse(r.bytes.toString("utf8")) as NominatimHit[]);
    } catch { /* try the next phrasing, then Overpass */ }
  }
  const found = nominatimPlaces(lists, { name: a.name, domain: a.domain }, limit);
  if (found.length >= Math.min(4, limit)) return found;
  // 2. Overpass: every mapped place of that kind in the area.
  const bbox = await geocode(a.area);
  const q = encodeURIComponent(overpassQuery(filters, bbox));
  let last: unknown = null;
  // Public Overpass servers rate-limit and go down; try the mirrors in turn.
  for (const host of OVERPASS.slice(0, 2)) {
    try {
      const r = await fetchPublic(`${host}?data=${q}`, 3_000_000, { "User-Agent": UA, Accept: "application/json,*/*" }, 10_000);
      const j = JSON.parse(r.bytes.toString("utf8")) as { elements?: { tags?: Record<string, string> }[] };
      const more = rankPlaces(j.elements ?? [], { name: a.name, domain: a.domain }, limit);
      return [...found, ...more.filter((m) => !found.some((f) => f.name === m.name))].slice(0, limit);
    } catch (e) { last = e; }
  }
  if (found.length) return found;
  throw new Error(`OpenStreetMap search is unavailable right now (${(last as Error)?.message ?? "no answer"}).`);
}
