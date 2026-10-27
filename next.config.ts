import type { NextConfig } from "next";

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname : "localhost";

const config: NextConfig = {
  poweredByHeader: false,
  images: { remotePatterns: [{ protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }] },
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
        // Report-only first: logs what a strict policy would block without breaking anything; enforce once clean.
        { key: "Content-Security-Policy-Report-Only", value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' https://connect.facebook.net https://js.paystack.co",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          `img-src 'self' data: blob: https://${supabaseHost} https://*.fbcdn.net https://*.cdninstagram.com`,
          `media-src 'self' blob: https://${supabaseHost}`,
          `connect-src 'self' https://${supabaseHost} wss://${supabaseHost} https://graph.facebook.com https://api.paystack.co`,
          "frame-src https://www.facebook.com https://checkout.paystack.com",
          "frame-ancestors 'self'", "base-uri 'self'", "form-action 'self' https://www.facebook.com",
        ].join("; ") },
      ],
    }];
  },
};
export default config;
