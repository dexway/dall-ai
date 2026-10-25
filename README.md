# Dall AI

AI assistants for Nigerian businesses that answer, sell and check the money: web chat today, with WhatsApp, SMS, USSD and voice designed in.
Next.js 15 + Supabase (Postgres, Auth, Storage) + Claude, deployed on Vercel.

## What works in this version (the "sell-and-verify" slice)

| Area | What you get |
|---|---|
| Landing page | Eko Media palette, glass chat hero, channels, sell & verify, flow builder, use cases, identity studio, comparison, naira pricing, "Trusted by" strip (`lib/partners.ts`). |
| Auth | Email + password sign up / log in, email confirmation callback, protected `/dashboard`, `/onboarding`, `/admin`. |
| Workspaces | Each business gets a private workspace (row level security on every table), trial plan, 150 credits, a default assistant. |
| Assistant | Name, face, personality, greeting, reply languages (English, Pidgin, Yorùbá, Igbo, Hausa), voice style for later voice channels, brand colour, max discount. |
| Launch kit | 4-slide carousel rendered from the assistant's identity and your photos (save as PNG), plus AI-written Instagram caption, WhatsApp status and 15-second clip script. |
| Catalogue | Products, services, bookings, classes, packages with naira prices, intro prices, stock, photos, terms. |
| Customer chat | `/chat/<business-slug>`: the assistant searches the catalogue, quotes exact totals (computed on the server), creates the order and sends a checkout link. |
| Checkout | `/pay/<token>`: customer approves the itemised order, then pays by Paystack (to the business's own account) or bank transfer + receipt upload. |
| Payment verification | Paystack: signed webhook + server-side verify (reference, amount, currency, status). Transfers: receipt read by Claude, compared with the order, flagged; a person approves. A screenshot never marks an order paid. |
| Back office | Overview (real numbers only), orders + detail with conversation and audit history, payments to check, payment settings. |
| AI gateway + billing | Every Claude call goes through `lib/ai/gateway.ts`: plan + model check, atomic credit reservation, rate and concurrency limits, timeout/retry caps, settlement from the provider's real token usage, per-workspace usage events. Credit ledger is append-only. Top-ups via Dall AI's own Paystack account. |
| Platform admin | `/admin`: AI kill switch, global daily cap, per-workspace usage and estimated cost, top-up revenue, margin estimate, credit adjustments with reasons, suspend/reactivate. |

The two money systems never share tables: **platform billing** (`platform_*`, `usage_*`, `ai_*`, `credit_*`) vs **business commerce** (`orders`, `payments`, `payment_*`).

## Setup (about 20 minutes)

### 1. Supabase
1. Create a free project at supabase.com (region: closest to Lagos, e.g. `eu-west-2` London or `af-south-1` if offered).
2. **SQL Editor → New query** → paste all of `supabase/migrations/0001_init.sql` → Run.
3. **Project Settings → API**: copy the Project URL, `anon` key and `service_role` key.
4. **Authentication → URL Configuration**: Site URL = your domain (or `http://localhost:3000`); add `<your-domain>/auth/callback` to Redirect URLs.
5. Make yourself a platform admin (after you've signed up once):
   ```sql
   insert into platform_admins (user_id) select id from auth.users where email = 'you@example.com';
   ```

### 2. Environment
Copy `.env.example` to `.env.local` and fill it in. Generate the encryption key with `openssl rand -base64 32`.
- `ANTHROPIC_API_KEY`: create a dedicated key in the Anthropic Console for this app. It stays on the server.
- `PLATFORM_PAYSTACK_SECRET_KEY`: your (Dall AI's) Paystack key for credit top-ups. Use `sk_test_…` first.
- No AI key yet? Set `AI_PROVIDER=test` to click through everything; replies are labelled TEST MODE and cost nothing.

### 3. Run locally
```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 21 tests: money, credits, receipts, Paystack signatures, and the real SQL (tenant isolation, ledger, limits)
```

### 4. Deploy on Vercel
Import the folder/repo in Vercel, add every variable from `.env.example` under Project → Settings → Environment Variables (server ones without `NEXT_PUBLIC_`), deploy, then set `NEXT_PUBLIC_SITE_URL` to the live URL.

### 5. Paystack webhooks
- Platform top-ups (your Paystack dashboard): `https://<domain>/api/webhooks/paystack/platform`
- Each business (their own Paystack dashboard): the URL shown on their **Payment settings** page, `https://<domain>/api/webhooks/paystack/<workspace-id>`

## Before going live
- **Prices**: `ai_cost_rate_cards` holds Claude prices per million tokens. Check them against Anthropic's current pricing and add a new version row when they change. Plans assume ~₦1,550/$; re-check margins (`/admin` shows the estimate; set `ADMIN_NGN_PER_USD`).
- **Name**: change `lib/config.ts` (`BRAND`). "Dall AI" is close to OpenAI's "DALL·E"; do a trademark check before investing in the brand. `dall.ai` in copy is a placeholder domain.
- **Partner logos**: `lib/partners.ts` + files in `public/partners/`. Ekomedia's logo was cut from a screenshot (794×216 PNG); swap in the official SVG when you have it, and only list partners who've agreed.
- **Languages**: have a native speaker check Yorùbá, Igbo and Hausa greetings.

## Not in this slice yet (designed for, not built)
WhatsApp Business API, SMS/USSD (Africa's Talking), voice calls and Nigerian TTS, visual flow builder, bundles/coupons engine, CSV catalogue import, team invites, support cases, class schedules, monthly plan renewal billing, refunds. The schema and gateway are shaped so each plugs in without touching the money logic.
