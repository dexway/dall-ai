import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { fetchPublic, checkUrlShape } from "@/lib/net-guard";
import { parsePage, pickImages, imageSize, type SitePage } from "@/lib/creative/site-parse";
import { BrandProfile } from "@/lib/creative/schemas";

const MAX_PAGES = 5, MAX_IMAGES = 12, MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export type SiteContent = {
  site: string; imported_at: string;
  pages: SitePage[];
  images: { path: string; source_url: string; alt: string; page: string; width: number | null; height: number | null; logo: boolean }[];
  skipped: number;
};

/**
 * Reads the brand's website (home page plus up to 4 key pages such as About, Menu, Rooms, Services,
 * Gallery), keeps the readable text, and copies the best photos into the brand's private storage.
 * Public addresses only (net-guard). Photos are added to the brand files the motion director uses.
 */
export async function importWebsite(brandId: string, deadlineMs = 45_000): Promise<SiteContent> {
  const db = supabaseAdmin();
  const started = Date.now();
  const { data: brand } = await db.from("creative_brands").select("id,workspace_id,profile,asset_paths").eq("id", brandId).single();
  if (!brand) throw new Error("Brand not found.");
  const raw = BrandProfile.parse(brand.profile ?? {}).website;
  if (!raw) throw new Error("Add your website in the brief first.");
  const home = checkUrlShape(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).toString();
  try {
    const pages: SitePage[] = [], found = [] as ReturnType<typeof parsePage>["images"];
    const queue = [home], seen = new Set<string>();
    while (queue.length && pages.length < MAX_PAGES && Date.now() - started < deadlineMs / 2) {
      const url = queue.shift()!;
      if (seen.has(url)) continue;
      seen.add(url);
      try {
        const r = await fetchPublic(url, 1_500_000);
        if (!r.contentType.includes("html")) continue;
        const p = parsePage(r.bytes.toString("utf8"), r.url);
        pages.push(p.page);
        found.push(...p.images);
        if (pages.length === 1) queue.push(...p.links.slice(0, 12)); // follow links from the home page only
      } catch { /* one bad page doesn't stop the import */ }
    }
    if (!pages.length) throw new Error("Couldn't read that website. Check the link is public.");

    const images: SiteContent["images"] = [];
    let skipped = 0;
    for (const [i, img] of pickImages(found, MAX_IMAGES + 6).entries()) {
      if (images.length >= MAX_IMAGES || Date.now() - started > deadlineMs) break;
      try {
        const r = await fetchPublic(img.url, MAX_IMAGE_BYTES);
        const ext = TYPES[r.contentType];
        const size = imageSize(r.bytes);
        if (!ext || r.truncated || r.bytes.length < 8_000 || (size && Math.min(size.width, size.height) < (img.logo ? 64 : 320))) { skipped++; continue; }
        const slug = (img.alt || new URL(img.url).pathname.split("/").pop() || "photo").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "photo";
        const path = `${brand.workspace_id}/${brand.id}/site/${i + 1}-${slug}.${ext}`;
        const up = await db.storage.from("creative-assets").upload(path, r.bytes, { contentType: r.contentType, upsert: true });
        if (up.error) { skipped++; continue; }
        images.push({ path, source_url: img.url, alt: img.alt, page: img.page, width: size?.width ?? null, height: size?.height ?? null, logo: img.logo });
      } catch { skipped++; }
    }
    const content: SiteContent = { site: home, imported_at: new Date().toISOString(), pages, images, skipped };
    const assets = [...new Set([...images.map((x) => x.path), ...((brand.asset_paths as string[]) ?? []).filter((p) => !p.includes("/site/"))])].slice(0, 40);
    await db.from("creative_brands").update({ site_content: content, site_imported_at: content.imported_at, site_import_error: null, asset_paths: assets, updated_at: content.imported_at }).eq("id", brand.id);
    return content;
  } catch (e) {
    await db.from("creative_brands").update({ site_import_error: (e as Error).message.slice(0, 300), site_imported_at: new Date().toISOString() }).eq("id", brand.id);
    throw e;
  }
}

/** Scheduler step: brands with a website and a motion project but no import yet (a couple per run). */
export async function importPendingSites(limit = 2, deadlineMs = 40_000): Promise<number> {
  const db = supabaseAdmin();
  const { data: offers } = await db.from("launch_video_offers").select("brand_id").not("brand_id", "is", null).limit(200);
  const ids = [...new Set((offers ?? []).map((o) => o.brand_id as string))];
  if (!ids.length) return 0;
  const { data: brands } = await db.from("creative_brands").select("id").in("id", ids).is("site_imported_at", null).limit(limit);
  let done = 0;
  for (const b of brands ?? []) {
    try { await importWebsite(b.id, deadlineMs / limit); done++; } catch { /* error saved on the brand */ }
  }
  return done;
}
