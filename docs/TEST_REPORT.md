# Test report — Meta ads + multi-channel agent build (27 Oct 2026)

Legend: **PASS-LIVE** = ran against production (dall-ai.vercel.app + Supabase). **PASS-MOCK** = automated test with a fake
Meta/AI (no real credentials). **BLOCKED** = needs something outside the code (named). Nothing below is marked passed without running it.

## Automated suite (`npm test`): 54 passed, 0 failed

| Area | Tests | Type |
|---|---|---|
| WhatsApp/Messenger/Instagram webhook parsing: text, images, buttons, locations, ad referrals (`ctwa_clid`, `ad_id`), OPEN_THREAD referrals, delivery + read receipts, echo filtering | `tests/events.test.ts` | PASS-MOCK |
| Messaging windows (24h, 7-day HUMAN_AGENT tag, WhatsApp template required) | `tests/events.test.ts` | PASS-MOCK |
| Outbound send: retry once on 429/5xx, returns platform id, throws on rejection (no fake success) | `tests/events.test.ts` | PASS-MOCK |
| Ads: pause (campaign) / resume (ad → ad set → campaign), Meta error surfaces, budget + schedule edits, ad text edit via new creative, insights parsing + paging, edit validation | `tests/ads.test.ts` | PASS-MOCK |
| Webhook idempotency (provider + event key), retried inbound message stored once | `tests/isolation.test.mjs` | PASS (real Postgres, all migrations) |
| Tenant isolation: conversations, messages, leads, webhook events, integration errors, ad campaigns, ad insights | `tests/isolation.test.mjs` | PASS (real Postgres, RLS) |
| Owners can't forge leads/events directly; message roles limited | `tests/isolation.test.mjs` | PASS |
| Existing features (money, credits, receipts, early pay, Meta parser, ad errors) | existing tests | PASS (regression) |
| Production build (`next build`) | all routes compile | PASS |

## Live checks on production

| Check | Result |
|---|---|
| Messenger/Instagram webhook verify: right token returns challenge, wrong token 403 | PASS-LIVE |
| WhatsApp webhook verify, wrong token 403 | PASS-LIVE |
| Unsigned and forged-signature webhook POSTs rejected 401 (both endpoints) | PASS-LIVE |
| Daily job `/api/cron/daily` rejects missing/wrong secret (401) | PASS-LIVE |
| Inbox redirects signed-out visitors to login | PASS-LIVE |
| Website chat: message stored, conversation marked unread with window timestamps | PASS-LIVE |
| Human takeover on website chat: AI stays silent, visitor gets the team reply via polling | PASS-LIVE |
| Another visitor's token can't read team replies or switch an order to pay-on-delivery | PASS-LIVE |
| Migrations 0012/0013 applied to Supabase | PASS-LIVE |
| Test data removed afterwards | done |

## Blocked (needs action outside the code)

| Check | Blocked by |
|---|---|
| Any AI reply (all channels) | **Anthropic account out of credit** — "credit balance is too low" on every call |
| Real inbound Messenger/Instagram message through the new pipeline | AI credit; for Instagram, the app must be Live (published) |
| Real WhatsApp inbound/outbound, delivery statuses, templates | No WhatsApp number connected yet |
| OAuth permission-denied path with a real account | Needs a manual login where a permission is unticked |
| Token expiry → "Reconnect" flow with a real expired token | Needs a real expired token (logic covered by mocks) |
| Campaign pause/resume/edit/sync against Meta | No campaign exists on Meta yet (all 6 earlier attempts failed before the fix); reconnect Facebook so `pages_manage_ads` is granted, then create a draft |
| Ad attribution from a real click-to-message ad | Needs a live ad and a real tap |
| Daily background job running | `CRON_SECRET` not yet set in Vercel |
| Visual check of Inbox / Leads / Ads on mobile and desktop | Needs a signed-in session (I don't log into your account); responsive CSS is in place but unverified by eye |

## Known limits (by design, stated in the UI)

- Ads: the click-to-message objective (engagement → conversations) only; other objectives (traffic, sales, leads forms) not built.
- One assistant per business; every channel uses it. Per-channel behaviour is "replies on" or "inbox only".
- Background jobs run daily (Vercel Hobby limit); "Sync now" on Ads refreshes on demand.
- Attachments are recorded and described to the assistant; media files themselves are not downloaded or shown.
