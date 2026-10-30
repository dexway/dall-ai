// Harvey's profile stage (pure, testable): reads a prospect's own pages and records buying signals,
// each with the evidence that shows it, plus the people and contact details the site publishes.
// No model call; a wrong signal in an email is worse than none, so every check is conservative.

export type Signal = { key: string; label: string; evidence: string; url: string };
export type Person = { name: string; title: string; email?: string };
export type Contacts = { emails: string[]; phones: string[]; whatsapp: string[]; people: Person[] };

const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const snippet = (t: string, i: number) => t.slice(Math.max(0, i - 60), i + 90).trim();

export const hasBooking = (html: string) => /calendly\.com|acuityscheduling|booksy|fresha\.com|opentable|setmore|simplybook|\b(book now|book online|book an appointment|reserve (?:a|your) table)\b/i.test(html);
export const hasWhatsapp = (html: string) => /wa\.me\/|api\.whatsapp\.com|whatsapp/i.test(html);

/** Absence signals hold only if no page that was read shows the thing. */
export function mergeSignals(perPage: { html: string; signals: Signal[] }[]): Signal[] {
  const anyBooking = perPage.some((x) => hasBooking(x.html)), anyWa = perPage.some((x) => hasWhatsapp(x.html));
  const out: Signal[] = [];
  for (const x of perPage) for (const sg of x.signals) {
    if ((sg.key === "NO_ONLINE_BOOKING" && anyBooking) || (sg.key === "NO_WHATSAPP" && anyWa)) continue;
    if (!out.some((y) => y.key === sg.key)) out.push(sg);
  }
  return out;
}

/** Buying signals on one page. Each check needs concrete markup or wording, never a guess. */
export function detectSignals(html: string, url: string): Signal[] {
  const out: Signal[] = [];
  const t = text(html), lower = t.toLowerCase();
  const add = (key: string, label: string, evidence: string) => { if (!out.some((s) => s.key === key)) out.push({ key, label, evidence: evidence.slice(0, 220), url }); };

  if (/connect\.facebook\.net\/[^"']*fbevents|fbq\(\s*['"]init/i.test(html)) add("RUNNING_META_ADS", "Running Facebook/Instagram ads", "Meta Pixel installed on the site");
  if (/googleadservices\.com|gtag\(\s*['"]config['"]\s*,\s*['"]AW-/i.test(html)) add("RUNNING_GOOGLE_ADS", "Running Google Ads", "Google Ads conversion tag on the site");
  const hire = lower.search(/\b(we(?:'| a)re hiring|join our team|careers|vacanc(?:y|ies)|now hiring|job openings?)\b/);
  if (hire >= 0) add("HIRING", "Hiring", snippet(t, hire));
  const events = lower.search(/\b(upcoming events?|book (?:a|your) (?:table|event|venue)|corporate events?|conference(?:s)?|end[- ]of[- ]year part(?:y|ies)|corporate retreats?|banquet(?:s| hall)?|event (?:hall|space|centre|center))\b/);
  if (events >= 0) add("HOSTS_EVENTS", "Hosts or books events", snippet(t, events));
  const growth = lower.search(/\b(new (?:branch|location|office|outlet)|now open|grand opening|opening soon|expanding|we(?:'| ha)ve moved)\b/);
  if (growth >= 0) add("GROWING", "Opening or expanding", snippet(t, growth));
  const staff = lower.match(/\b(\d{2,4})\+?\s*(?:staff|employees|team members|professionals|people)\b/);
  if (staff) add("TEAM_SIZE", `Team of about ${staff[1]}`, snippet(t, staff.index ?? 0));
  if (!hasBooking(html) && /\b(call us|contact us|send us a message|enquir)/i.test(t)) add("NO_ONLINE_BOOKING", "No online booking", "Visitors have to call or message to book");
  if (!hasWhatsapp(html)) add("NO_WHATSAPP", "No WhatsApp contact on the site", "No WhatsApp link or number found");
  return out;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BAD_EMAIL = /\.(png|jpe?g|gif|webp|svg)$|example\.|sentry|wixpress|domain\.com|email\.com|yourname/i;
const TITLES = "CEO|Chief Executive Officer|Founder|Co-Founder|Managing Director|MD|Director|General Manager|Owner|Proprietor|Proprietress|President|Partner|Principal|Head of [A-Z][a-z]+|Admin(?:istration)? Manager|Office Manager|HR Manager|Operations Manager|Procurement Manager|Facility Manager|Chairman";

/** Emails, phones, WhatsApp numbers and named people with titles that the site publishes. */
export function extractContacts(html: string, domain: string | null): Contacts {
  const t = text(html);
  const mailto = [...html.matchAll(/mailto:([^"'?\s>]+)/gi)].map((m) => decodeURIComponent(m[1]));
  const emails = [...new Set([...mailto, ...(t.match(EMAIL) ?? [])].map((e) => e.toLowerCase().replace(/[.,;:]+$/, "")))]
    .filter((e) => !BAD_EMAIL.test(e))
    .sort((a, b) => Number(Boolean(domain && b.endsWith(domain))) - Number(Boolean(domain && a.endsWith(domain))))
    .slice(0, 6);
  const tel = [...html.matchAll(/tel:([+\d][\d\s().-]{6,})/gi)].map((m) => m[1].replace(/[^\d+]/g, ""));
  const ng = [...t.matchAll(/(?:\+?234|0)[\s-]?[789][01]\d[\s-]?\d{3}[\s-]?\d{4}/g)].map((m) => m[0].replace(/[^\d+]/g, ""));
  const phones = [...new Set([...tel, ...ng])].filter((p) => p.replace(/\D/g, "").length >= 10).slice(0, 4);
  const whatsapp = [...new Set([...html.matchAll(/(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)(\d{8,15})/gi)].map((m) => m[1]))].slice(0, 3);
  const people: Person[] = [];
  const re = new RegExp(`\\b([A-Z][a-z]+(?:[ -][A-Z][a-z]+){1,2})\\s*(?:[,–—|-]|\\(|\\s)\\s*(${TITLES})\\b`, "g");
  for (const m of t.matchAll(re)) {
    // Drop a lead-in word ("Meet Adaeze Okafor" → "Adaeze Okafor"); a real name needs two words left.
    const words = m[1].trim().split(/[ ]+/);
    while (words.length && /^(Our|The|Meet|Contact|About|Lagos|Nigeria|Read|Learn|Call|Dear|By|With|From)$/.test(words[0])) words.shift();
    if (words.length < 2) continue;
    const name = words.join(" ");
    if (!people.some((p) => p.name === name)) people.push({ name, title: m[2] });
    if (people.length >= 4) break;
  }
  return { emails, phones, whatsapp, people };
}

/** Pages worth reading after the home page: contact, about, team, services. */
export function profileLinks(links: string[]): string[] {
  const want = /(contact|about|team|our-story|leadership|management|services|careers)/i;
  return links.filter((l) => want.test(new URL(l).pathname)).slice(0, 3);
}

export const STAGES = ["new", "researched", "drafted", "contacted", "replied", "meeting", "proposal", "won", "lost"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = { new: "New", researched: "Researched", drafted: "Ready to send", contacted: "Contacted", replied: "Replied", meeting: "Meeting", proposal: "Proposal sent", won: "Won", lost: "Lost" };

/** Domain for de-duplication: "https://www.acme.ng/about" → "acme.ng". */
export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
}

/** One-tap send links: the owner sends from their own email or WhatsApp. */
export function mailtoLink(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
export function whatsappLink(number: string, body: string): string {
  let n = number.replace(/\D/g, "");
  if (n.startsWith("0") && n.length === 11) n = `234${n.slice(1)}`; // Nigerian local format
  return `https://wa.me/${n}?text=${encodeURIComponent(body)}`;
}

/** Deals that need a follow-up: contacted, no reply yet, quiet for `days`. */
export function followupDue(p: { stage: string; updated_at: string }, lastOut: string | null, lastIn: string | null, days: number, now = Date.now()): boolean {
  if (p.stage !== "contacted" || !lastOut) return false;
  if (lastIn && Date.parse(lastIn) > Date.parse(lastOut)) return false;
  return now - Date.parse(lastOut) >= days * 86_400_000;
}
