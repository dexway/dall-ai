import type { Metadata, Viewport } from "next";
import { BRAND } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${BRAND.name} — ${BRAND.tagline}`, template: `%s · ${BRAND.name}` },
  description: "AI assistants that answer, sell and confirm payments for Nigerian businesses on WhatsApp, Instagram, Messenger and web chat.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://dall-ai.vercel.app"),
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: BRAND.name, images: [{ url: "https://xmjgpprmddptoldhrswj.supabase.co/storage/v1/object/public/brand-assets/site/hero/owner-kitchen.jpg", width: 1200, height: 630 }] },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#14231F" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NG">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=IBM+Plex+Mono:wght@400;500&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
