# Dall AI — working notes for Claude Code

AI sales agents for Lagos businesses on WhatsApp, Instagram, Messenger and web chat. They quote from the catalogue, take
bank-transfer orders and check receipts; the owner always confirms payments.

## Stack
- Next.js 15.5 App Router (server actions, `after()`), TypeScript, deployed on Vercel (project `dall-ai`, prod https://dall-ai.vercel.app).
- Supabase project `xmjgpprmddptoldhrswj`: RLS via `is_member` / `is_manager`; server writes use `supabaseAdmin()` (service role).
- Anthropic for replies (gateway in `lib/ai`), Higgsfield for image/video, Meta Graph API for channels, ads and posting.

## Commands
- `npm test` — node --test with --experimental-strip-types (pglite runs every migration). No TS parameter properties in files tests import.
- `npx tsc --noEmit -p .` and `npx next build` before pushing.
- Migrations live in `supabase/migrations/NNNN_*.sql`; 0001–0022 are applied in production; 0023 (motion generation) is not yet.

## Map
- Channels: `lib/channels/{events,send,process}.ts`, webhooks in `app/api/webhooks/*`.
- Agent: `lib/ai/agent.ts` (tools: catalogue, checkout, orders, leads, handoff, promos, consent); presets in `lib/presets.ts`.
- Orders, payments: `lib/orders.ts`, `lib/payments.ts`; bank changes need an emailed OTP code (`app/dashboard/settings`).
- Marketing: `lib/marketing.ts` (follow-ups, broadcasts), `lib/promo.ts`, autopilot in `lib/autopilot.ts`, social posting in `lib/social-publish.ts`.
- Content Creator / Creative Director: `lib/creative/*` (router.ts picks the best enabled model per task), UI `app/dashboard/studio`, admin `app/admin/creative`.
- Cron: pg_cron calls `/api/cron/marketing` every 5 min (Vault secret); Vercel cron `/api/cron/daily` uses `CRON_SECRET`.
- Security: `lib/rate-limit.ts`, `lib/net-guard.ts` (SSRF), CSP report-only and Permissions-Policy in `next.config.ts`.

## Rules
- Never handle or log secrets; the owner adds keys in Vercel/Supabase.
- No paid generation or spend without an owner-set cap or explicit confirmation.
- Messaging follows Meta windows: free text within 24h, HUMAN_AGENT tag up to 7 days, WhatsApp templates after 24h.

## Open items (need the owner's logins)
1. Top up Anthropic credit (all AI calls fail until then).
2. Set `CRON_SECRET` in Vercel.
3. Supabase: add `{{ .Token }}` to the Magic Link email template; turn on leaked-password protection and password/email change alerts.
4. Meta: `META_APP_SECRET`, `META_LOGIN_CONFIG_ID`; add `pages_manage_posts` and `instagram_content_publish` to the login configuration;
   App Review (use /privacy and /data-deletion); reconnect.
5. Higgsfield keys; confirm model prices in /admin/creative, enable models, set the platform media cap.
6. Confirm the contact address (currently hello@dall.ai, override with `NEXT_PUBLIC_SUPPORT_EMAIL`).
7. Later: custom email sender (Resend), custom domain, enforce CSP, full retest once AI credit is back.
