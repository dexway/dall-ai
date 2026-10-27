import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const site = process.env.NEXT_PUBLIC_SITE_URL || "https://dall-ai.vercel.app";
  return { rules: [{ userAgent: "*", allow: ["/", "/chat/"], disallow: ["/dashboard", "/admin", "/api/", "/pay/", "/onboarding"] }], sitemap: `${site}/sitemap.xml` };
}
