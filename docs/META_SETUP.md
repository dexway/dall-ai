# Meta setup for Dall AI

One Meta app ("Dall AI", ID 1429062082545171) serves every business on Dall AI. Businesses connect their own
Pages, Instagram accounts, WhatsApp numbers and ad accounts to it through Meta's own login screens; Dall AI never
sees their Facebook password, and every token is encrypted (AES, `ENCRYPTION_KEY`) before it is stored.

## 1. App settings (developers.facebook.com → Dall AI)

| Where | Setting | Value |
|---|---|---|
| App settings → Basic | App domains | `dall-ai.vercel.app` (plus your custom domain later) |
| | Privacy policy URL | required before App Review and Live mode |
| | Terms of service URL | recommended |
| | Data deletion instructions URL | required before App Review |
| | Category | Business and pages |
| | App icon (1024×1024) | required before App Review |
| Facebook Login for Business → Settings | Valid OAuth redirect URIs | `https://dall-ai.vercel.app/api/meta/facebook/callback` |
| Facebook Login for Business → Configurations | Create a configuration | Token type **User access token**; assets: Pages, Instagram accounts, Ad accounts; permissions listed in §2. Put its ID in `META_LOGIN_CONFIG_ID`. |
| WhatsApp → Embedded Signup | Configuration | Put its ID in `NEXT_PUBLIC_META_CONFIG_ID` |

## 2. Permissions (request only what the business turns on)

| Feature | Permissions | Access level needed for other businesses |
|---|---|---|
| List & pick Pages | `pages_show_list`, `business_management` | Advanced (App Review) |
| Messenger replies | `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement` | Advanced |
| Instagram DM replies | `instagram_basic`, `instagram_manage_messages` (+ the Page permissions above) | Advanced |
| WhatsApp | `whatsapp_business_messaging`, `whatsapp_business_management` (granted through Embedded Signup) | Advanced + Tech Provider |
| Ads (create, pause, edit) | `ads_management`, `pages_manage_ads` | Advanced + Ads Management Standard Access |
| Ads reporting | `ads_read` | Advanced |

Until App Review is approved, only people with a role on the Meta app (admin, developer, tester) can connect.
Dall AI checks `/me/permissions` after login and warns on the Channels page when a permission was unticked.

## 3. Webhooks

| Product | Callback URL | Verify token env | Fields to subscribe |
|---|---|---|---|
| WhatsApp Business Account | `https://dall-ai.vercel.app/api/webhooks/whatsapp` | `WHATSAPP_VERIFY_TOKEN` | `messages` (includes delivery statuses) |
| Page (Messenger) | `https://dall-ai.vercel.app/api/webhooks/meta` | `META_WEBHOOK_VERIFY_TOKEN` | `messages`, `messaging_postbacks`, `messaging_referrals`, `message_deliveries`, `message_reads` |
| Instagram | `https://dall-ai.vercel.app/api/webhooks/meta` | `META_WEBHOOK_VERIFY_TOKEN` | `messages`, `messaging_postbacks`, `messaging_referral`, `message_reactions` (optional) |

Every POST is checked against `X-Hub-Signature-256` with `META_APP_SECRET`; unsigned or wrongly signed requests get 401.
Events are stored in `webhook_events` keyed by provider + platform id, so Meta's retries are processed once.
Failed events are retried by the daily job (`/api/cron/daily`, up to 5 attempts within 3 days).

Instagram webhooks are only delivered once the app is **Live** (published). Messenger webhooks reach app-role users in Development mode.

## 4. Business verification and review

1. Business verification of the Meta business portfolio that owns the app (Business settings → Security center).
2. App Review for every permission in §2 marked Advanced, with a screencast of each feature working.
3. WhatsApp **Tech Provider** onboarding (to let other businesses connect numbers through Embedded Signup).
4. Marketing API **Standard Access** for `ads_management` (higher rate limits; needed for other businesses' ad accounts).
5. Switch the app to **Live** mode.

## 5. Messaging policies Dall AI enforces

- Free-form replies only within **24 hours** of the customer's last message, on every channel.
- Messenger and Instagram: a **team member** (never the AI) may reply up to **7 days** with the `HUMAN_AGENT` tag.
- WhatsApp after 24 hours: only an **approved template** (the inbox loads them from the business's WABA).
- The assistant only replies to chats the customer starts, stops when a human takes over, and stops replying to a customer
  who sends more than 10 messages a minute.
- Ads are created **PAUSED**. Switching a campaign on requires the owner to tick a confirmation showing the daily budget.

## 6. Local development

```bash
cp .env.example .env.local      # fill in values (Supabase, Anthropic, ENCRYPTION_KEY, Meta)
npm install
npm test                        # unit + database tests; Meta and AI are mocked
npm run dev                     # http://localhost:3000
```

Meta can't call `localhost`. To receive real webhooks locally, expose port 3000 with a tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`)
and temporarily point a **test** app's webhook at the tunnel URL. Set `AI_PROVIDER=test` to run without an Anthropic key.

## 7. Production (Vercel + Supabase)

1. Apply migrations in `supabase/migrations/` in order (already applied to project `xmjgpprmddptoldhrswj`).
2. Set every variable from `.env.example` in Vercel (Production).
3. Set `CRON_SECRET` (any long random string). `vercel.json` schedules `/api/cron/daily` once a day (Hobby plan limit; upgrade to Pro for hourly).
4. Deploy, then verify each webhook in the Meta app (the GET challenge must return 200).
