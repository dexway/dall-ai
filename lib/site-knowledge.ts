// Turns a business website into the sales agent's knowledge: every page's readable text, including
// short lines like "Price from ₦ 230,000.00 Night" that live in plain divs. Pure, so tests can load it.

/** Pages worth reading first: anything about what they sell, what it costs and how to reach them. */
const WORTH = /(rooms?|suites?|halls?|menu|prices?|pricing|rates?|tariff|packages?|plans?|services?|products?|shop|store|collection|catalog|offers?|book|events?|amenit|facilit|delivery|shipping|faq|about|contact|location|hours)/i;
const SKIP = /(feed|wp-json|xmlrpc|cdn-cgi|login|cart|checkout|account|privacy|terms|cookie|replytocom|tab=review|photos_only|\.(pdf|jpe?g|png|webp|gif|svg|zip|xml)$)/i;
const BLOCK = /<\/?(p|div|li|ul|ol|tr|td|th|h[1-6]|br|section|article|header|footer|nav|button|dt|dd|table|tbody|figcaption|blockquote)\b[^>]*>/gi;

const ENT: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", naira: "₦" };
export function decodeEntities(s: string): string {
  return s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, k) => ENT[k.toLowerCase()] ?? " ");
}

/** The readable lines of one page, in order. Scripts, styles, forms' hidden bits and blank lines dropped. */
export function pageLines(html: string): { title: string; lines: string[] } {
  const body = html.replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const title = decodeEntities((body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
  const inner = body.match(/<body[\s\S]*<\/body>/i)?.[0] ?? body;
  const lines = decodeEntities(inner.replace(BLOCK, "\n").replace(/<[^>]+>/g, " "))
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 1 && !/^(menu|hamburger toggle menu|skip to (main )?content|close|search)$/i.test(l));
  const out: string[] = [];
  for (const l of lines) if (out[out.length - 1] !== l) out.push(l);   // drop immediate repeats
  return { title, lines: out };
}

/** One key per page: "/index.php/rooms/" and "/rooms" are the same page. */
export function pageKey(u: string): string {
  const x = new URL(u);
  return (x.pathname.replace(/^\/index\.php/, "").replace(/\/+$/, "") || "/") + x.search;
}

/** Same-site links worth following, best first (rooms, menus, prices before blog posts). */
export function rankLinks(links: string[], home: string): string[] {
  const host = new URL(home).hostname.replace(/^www\./, "");
  const ok = links.filter((u) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, "") === host && !SKIP.test(x.pathname + x.search); } catch { return false; } });
  // "/index.php/rooms/" and "/rooms/" are usually the same page
  const seen = new Set<string>(), uniq: string[] = [];
  for (const u of ok) { const k = pageKey(u); if (!seen.has(k)) { seen.add(k); uniq.push(u); } }
  return uniq.sort((a, b) => Number(WORTH.test(new URL(b).pathname)) - Number(WORTH.test(new URL(a).pathname)));
}

/**
 * One knowledge text for the agent: each page as its own section. A line that repeats across pages
 * on most pages (menus, footers) is kept the first time only; everything else stays with its own page,
 * so each room, product or package keeps its own price and details.
 */
export function knowledgeFromPages(pages: { url: string; html: string }[], maxChars = 40_000): string {
  const parsed = pages.map((p) => ({ url: p.url, ...pageLines(p.html) }));
  const count = new Map<string, number>();
  for (const p of parsed) for (const l of new Set(p.lines)) count.set(l, (count.get(l) ?? 0) + 1);
  const used = new Set<string>(), seenBodies = new Set<string>();
  let out = "";
  for (const p of parsed) {
    const lines = p.lines.filter((l) => {
      if (parsed.length < 3 || (count.get(l) ?? 0) < parsed.length * 0.6) return true;
      if (used.has(l)) return false;
      used.add(l);
      return true;
    });
    const body = lines.join("\n").slice(0, 6_000);
    if (!body || seenBodies.has(body)) continue;
    seenBodies.add(body);
    const block = `## ${p.title || p.url}\n(${p.url})\n${body}\n\n`;
    if (out.length + block.length <= maxChars) out += block;
    else if (maxChars - out.length > 400) out += block.slice(0, maxChars - out.length);
  }
  return out.trim();
}
