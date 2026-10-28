import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const site = process.env.NEXT_PUBLIC_SITE_URL || "https://dall-ai.vercel.app";
  return ["", "/signup", "/login", "/privacy", "/data-deletion"].map((p) => ({ url: `${site}${p}`, changeFrequency: "weekly", priority: p ? 0.5 : 1 }));
}
