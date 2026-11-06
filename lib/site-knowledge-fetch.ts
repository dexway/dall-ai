import "server-only";
import { fetchPublic, checkUrlShape } from "@/lib/net-guard";
import { parsePage } from "@/lib/creative/site-parse";
import { knowledgeFromPages, pageKey, rankLinks } from "@/lib/site-knowledge";

const MAX_PAGES = 16;

/**
 * Reads a business website for its sales agent: the home page, then the pages it links to that
 * matter most (rooms, menus, prices, services, contact), then the pages those link to, until
 * MAX_PAGES or the deadline. Public addresses only (net-guard re-checks every redirect).
 */
export async function learnSite(raw: string, deadlineMs = 25_000): Promise<{ knowledge: string; pages: number }> {
  const started = Date.now();
  const home = checkUrlShape(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).toString();
  const pages: { url: string; html: string }[] = [];
  const queued = new Set([pageKey(home)]), fetched = new Set<string>();
  let wave = [home];
  while (wave.length && pages.length < MAX_PAGES && Date.now() - started < deadlineMs) {
    const batch = wave.slice(0, MAX_PAGES - pages.length);
    const got = await Promise.all(batch.map(async (url) => {
      try {
        const r = await fetchPublic(url, 1_500_000, {}, 8_000);
        return r.contentType.includes("html") ? { url: r.url, html: r.bytes.toString("utf8") } : null;
      } catch { return null; }   // one bad page doesn't stop the rest
    }));
    const next: string[] = [];
    for (const p of got) {
      if (!p || fetched.has(pageKey(p.url))) continue;   // redirects can land two links on one page
      fetched.add(pageKey(p.url));
      pages.push(p);
      for (const u of rankLinks(parsePage(p.html, p.url).links, home)) if (!queued.has(pageKey(u))) { queued.add(pageKey(u)); next.push(u); }
    }
    wave = rankLinks(next, home);
  }
  if (!pages.length) throw new Error("Couldn't read that website. Check the link is public.");
  return { knowledge: knowledgeFromPages(pages), pages: pages.length };
}
