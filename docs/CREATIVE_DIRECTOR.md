# AI Creative Director + AI marketing tools

## What it does

**Creative Director** (`/dashboard/studio`), one workspace per brand. A business can run several brands.

1. **Brief.** A two-step wizard covers the brand profile, offers, voice, platforms, cadence, campaign dates, restrictions and prohibited claims. Brand files go to a private bucket.
2. **Accounts.**
   - The owner lists competitors, inspiration accounts, leaders and specific campaigns. The UI explains the difference between a competitor and an inspiration account, and flags gaps that would weaken the research.
   - "Suggest more accounts" finds real public accounts via web search. They arrive unaccepted until the owner keeps them.
3. **Research.**
   - Claude runs Anthropic's server-side `web_search` (it honours robots rules), with depth, geography, platforms and period set by the owner.
   - Every result URL Claude actually received is stored with its title, host, page age and retrieval date.
   - The report may only cite those URLs. Invented citations are removed automatically, and unsupported claims drop to "low confidence", shown as hypotheses.
   - The report has 10 sections, with confidence chips and clickable sources.
4. **Strategy.**
   - Claude acts as creative director, guided by a dedicated system prompt in `lib/creative/director.ts`. The output is validated JSON: positioning, segments, pillars, direction, visual language, tone, themes, channel roles, cadence, goals, measurement, the research behind each decision, and the ideas it rejected.
   - The owner approves, rejects or requests a revision. A revision keeps everything the feedback doesn't criticise.
5. **Calendar.**
   - Planned from the approved strategy only. Month, week and list views.
   - Every card carries the idea's objective, audience, insight, hook, execution, why now, differentiation, desired action, production needs, evidence (research with URLs, or hypothesis), measure, caption, CTA, visual direction and shots.
   - Per item: approve, reject, edit, reorder, remove, or regenerate that one item with feedback.
   - Approved items are locked, so the AI can't rewrite them.
6. **Production.**
   - Each approved item gets a production spec (validated JSON) for an admin-enabled Higgsfield model.
   - The server prices the batch. The owner sees the total and ticks "I authorize up to $X".
   - The server then re-prices, refuses if the price changed, enforces batch size and concurrency, and holds the budget before submitting.
   - Outputs are copied into Dall AI storage before the item is marked ready. The gallery offers downloads.
7. **Usage.** Claude spend, web searches, image and video counts, and media spend, each tracked separately. It shows held budget, limits, what's left, the reset date, and warnings at 80%.

**Marketing** (`/dashboard/marketing`)
- **Promotions:** the assistant checks live promotions before every total and applies the code at checkout. The server validates dates, uses, minimum order and items, and claims each use atomically.
- **Follow-ups:**
  - One reminder per unpaid chat checkout, after N minutes.
  - One AI-written nudge per quiet chat, at most once a week, always inside Meta's 24-hour window.
  - Never after a human takeover or a STOP.
  - Runs every 5 minutes.
- **Consent:** the assistant asks once and records the answer. Replying STOP opts the customer out everywhere, immediately.
- **Broadcasts:**
  - Only customers who opted in.
  - WhatsApp uses approved templates; Messenger and Instagram allow free text only within 24 hours.
  - Per-recipient results are recorded.
- **Add-on suggestion:** at most one item that fits the order, and the owner can switch it off.
- **Copilot:** shows best sellers, items asked about but not bought, unpaid value and audience sizes. It writes ad, post, status and broadcast copy that drops straight into Ads or Broadcasts.

## Database (migrations)

| File | Contents |
|---|---|
| 0015_marketing.sql | promotions, `claim_promo_use()`, consent/opt-out columns, marketing_settings, followups, broadcasts, broadcast_recipients |
| 0016_marketing_scheduler.sql | pg_cron + pg_net job every 5 min → `/api/cron/marketing`, with the bearer secret generated inside Supabase Vault (nobody handles it) |
| 0017_creative_director.sql | creative_brands, creative_accounts, research_runs, research_sources, creative_strategies, content_calendars, content_items, approval_events, provider_models, generation_jobs, quota_policies, budget_reservations, usage_ledger, creative_assets, private `creative-assets` bucket, `quota_used()`, `reserve_budget()`, `settle_budget()` |

Every table has RLS: members read their own workspace only, and all writes go through the server. The budget and promotion functions are callable only by the service role.

## Endpoints

- `POST /api/cron/marketing`: follow-ups, broadcasts and creative job polling. Requires the Vault bearer token or `CRON_SECRET`.
- `POST /api/webhooks/higgsfield`: Standard Webhooks signature, 5-minute replay window.
- Server actions in `app/dashboard/studio/actions.ts`, `app/dashboard/marketing/page.tsx` and `app/admin/creative/page.tsx`.

## Quotas and budget (how overspending is prevented)

- **Resources:** `claude_usd`, `claude_tokens`, `research_requests`, `image_generations`, `video_generations`, `media_usd`, each kept separate.
- **Policies:** at platform, plan, org (workspace), brand and user level, per day or month, with optional max batch and max concurrency. Admins edit them in `/admin/creative`, with no code change.
- **`reserve_budget()`:**
  - Takes a lock per resource.
  - Checks every applicable policy: used = booked charges + open holds.
  - Raises `QUOTA:<scope>:<period>:<limit>:<used>`, which the UI shows as a plain sentence with the reset date.
  - Inserts the hold. The same job reference returns the same hold, so double clicks, retries and parallel tabs can't double-reserve.
- **Defaults:** money resources with no platform policy raise `NOT_CONFIGURED`. Paid media generation stays OFF until an admin sets a platform `media_usd` cap. Claude spend is seeded at $50/month platform-wide.
- **`settle_budget()`:** books the charge once (idempotent) and releases the rest.
  - Claude is booked at actual cost (tokens plus $0.01 per web search).
  - Media is booked at the admin-set price, labelled "estimate", because Higgsfield doesn't return a per-request charge.
  - Failed, moderated and cancelled generations release their hold, since Higgsfield doesn't charge them.
- **Ambiguous submissions:** timeouts and 5xx responses are never blindly resubmitted. The job becomes `uncertain`, is retried with the same `Idempotency-Key`, and keeps its hold.

## Higgsfield setup (needs your login)

1. In the Higgsfield Console (console.higgsfield.ai), create an API key and add funds.
2. In Vercel, add the environment variables `HIGGSFIELD_API_KEY_ID` and `HIGGSFIELD_API_KEY_SECRET`.
3. Optional, for faster results: create a webhook signing secret and set `HIGGSFIELD_WEBHOOK_SECRET` (the `whsec_…` value). Without it, jobs are polled every 5 minutes.
4. In `/admin/creative`, add each model you want: its endpoint path and current price from the Console, the parameters it accepts, then Enabled.
5. In `/admin/creative`, add a platform `media_usd` monthly cap, plus any plan, org or user caps. Generation stays off until this exists.

Optional model selection: `CREATIVE_STRATEGY_MODEL` (strategy and research) and `CREATIVE_LIGHT_MODEL` (specs and repairs; default `claude-haiku-5-5`).

## Known limitations

- **Research coverage:** research sees only what the web search returns. Most Instagram and TikTok profile pages aren't indexed, so competitor social analysis leans on indexed posts, articles and websites. The report says this in its limitations section; no private data is ever claimed.
- **Status URLs:** Higgsfield's status URL is stored from each submit response. The fallback path `/requests/{id}/status` is unverified until the first live job.
- **Model parameters:** `aspect_ratio`, `duration` and the like are only sent if you tick them for that model. Check the model's page in the Console.
- **Media prices:** these are the admin-entered list prices. Reconcile them against Higgsfield's usage page monthly.
- **Long runs:** research runs inside the request that started it (up to 300 s). A run cut off by a timeout shows as failed and can be retried.
- **Not live-tested:** nothing in this feature has been tested live yet. The Anthropic account is out of credit, there are no Higgsfield credentials, and migrations 0015–0017 are waiting for Supabase approval.
