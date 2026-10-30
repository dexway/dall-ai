// Pure website parsing for the Content Creator (no server-only, so tests can load it). Pulls the
// readable text, the photos worth using in a video and the pages worth following from raw HTML.

export type SiteImage = { url: string; alt: string; page: string; score: number; logo: boolean };
export type SitePage = { url: string; title: string; description: string; headings: string[]; text: string };

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const clean = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))?.slice(1).find((v) => v !== undefined) ?? "";
const meta = (html: string, key: string) => {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) if ([attr(m[0], "property"), attr(m[0], "name")].some((v) => v.toLowerCase() === key)) return decode(attr(m[0], "content")).trim();
  return "";
};

/** Largest candidate from a srcset ("a.jpg 480w, b.jpg 1200w"). */
export function bestFromSrcset(srcset: string): string {
  const c = srcset.split(",").map((p) => p.trim().split(/\s+/)).filter((p) => p[0]).map(([u, d]) => ({ u, n: d ? parseFloat(d) || 0 : 0 }));
  return c.sort((a, b) => b.n - a.n)[0]?.u ?? "";
}

const SKIP = /(sprite|pixel|spacer|blank|tracking|favicon|placeholder|loader|spinner|badge|payment|visa|mastercard|paystack|flag|emoji|arrow|icon)/i;
const PAGE_WORDS = /(about|story|menu|rooms?|suites?|services?|gallery|photos|amenit|offers?|packages?|products?|shop|collection|book|events?|experience|spa|dining|our-)/i;

export function parsePage(html: string, pageUrl: string): { page: SitePage; images: SiteImage[]; links: string[] } {
  const base = new URL(pageUrl);
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const title = clean(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || meta(html, "og:title");
  const description = meta(html, "description") || meta(html, "og:description");
  const headings = [...body.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => clean(m[1])).filter((h) => h.length > 2 && h.length < 140).slice(0, 20);
  const main = body.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? body.replace(/<(nav|footer|header)[\s\S]*?<\/\1>/gi, " ");
  const paras = [...main.matchAll(/<(p|li|h[1-4]|blockquote|figcaption|td)[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => clean(m[2])).filter((t) => t.length > 25);
  const text = [...new Set(paras)].join("\n").slice(0, 6000);

  const abs = (u: string) => { try { const x = new URL(decode(u), base); x.hash = ""; return /^https?:$/.test(x.protocol) ? x.toString() : ""; } catch { return ""; } };
  const images: SiteImage[] = [];
  const push = (raw: string, alt: string, score: number) => {
    const url = abs(raw);
    if (!url || /\.(svg|gif|ico)(\?|$)/i.test(url) || url.startsWith("data:")) return;
    const logo = /logo/i.test(url + " " + alt);
    if (!logo && SKIP.test(url + " " + alt)) return;
    images.push({ url, alt: alt.slice(0, 160), page: pageUrl, score, logo });
  };
  const og = meta(html, "og:image") || meta(html, "twitter:image");
  if (og) push(og, title, 90);
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
    const t = m[0];
    const src = bestFromSrcset(attr(t, "srcset") || attr(t, "data-srcset")) || attr(t, "data-src") || attr(t, "data-lazy-src") || attr(t, "src");
    const w = Number(attr(t, "width")) || 0, h = Number(attr(t, "height")) || 0;
    if ((w && w < 200) || (h && h < 150)) continue;   // thumbnails and UI glyphs
    const alt = decode(attr(t, "alt")).trim();
    push(src, alt, 40 + (alt ? 15 : 0) + (w >= 1000 ? 20 : w >= 600 ? 10 : 0));
  }
  for (const m of body.matchAll(/background(?:-image)?\s*:\s*url\((['"]?)([^'")]+)\1\)/gi)) push(m[2], "", 35); // hero banners

  const links = [...new Set([...body.matchAll(/<a\b[^>]*>/gi).map((m) => abs(attr(m[0], "href")))])]
    .filter((u) => { try { const x = new URL(u); return x.hostname === base.hostname && !/\.(pdf|jpe?g|png|webp|zip)$/i.test(x.pathname) && x.pathname !== base.pathname; } catch { return false; } })
    .sort((a, b) => Number(PAGE_WORDS.test(b)) - Number(PAGE_WORDS.test(a)));
  return { page: { url: pageUrl, title, description, headings, text }, images, links };
}

/** Best images across pages, one per URL, highest score first; logos kept but capped at one. */
export function pickImages(all: SiteImage[], max = 12): SiteImage[] {
  const byUrl = new Map<string, SiteImage>();
  for (const i of all) { const k = i.url.replace(/\?.*$/, ""); const prev = byUrl.get(k); if (!prev || prev.score < i.score) byUrl.set(k, i); }
  const list = [...byUrl.values()].sort((a, b) => b.score - a.score);
  const logo = list.find((i) => i.logo);
  return [...(logo ? [logo] : []), ...list.filter((i) => !i.logo)].slice(0, max);
}

/** Width and height from PNG, JPEG or WEBP bytes (null when unknown). */
export function imageSize(b: Buffer): { width: number; height: number } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (kind === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L") { const n = b.readUInt32LE(21); return { width: (n & 0x3fff) + 1, height: ((n >> 14) & 0x3fff) + 1 }; }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

/** Website content as the motion director reads it: page facts, then the photo list. */
export function siteDigest(pages: SitePage[], maxChars = 9000): string {
  let out = "";
  for (const p of pages) {
    const block = `## ${p.title || p.url} (${p.url})\n${p.description ? `${p.description}\n` : ""}${p.headings.length ? `Headings: ${p.headings.join(" | ")}\n` : ""}${p.text}\n\n`;
    if (out.length + block.length > maxChars) { out += block.slice(0, Math.max(0, maxChars - out.length)); break; }
    out += block;
  }
  return out.trim();
}
