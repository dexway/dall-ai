# Backend Requirements: Dall AI — sell-and-verify slice

## Context
Dall AI gives Lagos businesses an AI assistant with its own name, face and voice that answers customers, quotes from the business's real catalogue, creates orders, takes payment (Paystack or bank transfer) and helps the owner verify transfers. Three kinds of people use it: the **business owner/staff** (dashboard), the **business's customers** (chat + checkout, no account), and the **platform owner** (admin). Success = a customer goes from "how much?" to a confirmed, verified payment without the owner typing a reply, and nobody can fake a payment or see another business's data.

Let me know if any of this doesn't fit how the data is structured; open to a simpler approach anywhere below.

## Screens/Components

### Sign up / Log in / Password reset
**Purpose**: Get a business owner into their private workspace.
**Data I need to display**: whether sign-up needs email confirmation; a friendly reason when login fails.
**Actions**:
- Create account with name, email, password → account exists; either signed in or told to check email
- Log in → land on the page they were trying to reach, or the dashboard
- Forgot password → receive a reset link; set a new password from it
**States to handle**: wrong password; unconfirmed email; expired/used email link; already signed in (skip the form).
**Business rules affecting UI**: private areas must bounce signed-out visitors to login and back again afterwards.

### Onboarding
**Purpose**: Create the business workspace on first login.
**Data I need to display**: nothing pre-filled.
**Actions**: enter business name + type → workspace created with a trial plan, starter credits, a default assistant, empty payment settings; a public chat address derived from the name.
**States to handle**: name already taken as an address (should still succeed with a variation); user who already has a workspace (skip).

### Overview
**Purpose**: The owner's "how is business" glance.
**Data I need to display**: confirmed sales in the last 30 days (money actually verified, never pending), count of orders awaiting payment, count of receipts waiting for review, conversation count, the 6 most recent orders with status + total + time, the assistant's name, the public chat link, whether the catalogue is empty (to show the getting-started steps).
**States to handle**: brand new workspace (all zeros, show setup steps); receipts waiting (draw attention).
**Business rules affecting UI**: every number must come from real records.

### Assistant & launch kit
**Purpose**: Define the assistant's identity and produce launch marketing.
**Data I need to display**: name, job title, personality, greeting, reply languages, voice style, brand colour, discount limit, avatar image, up to 6 brand photos.
**Actions**:
- Save identity (with avatar/photo uploads) → used from the next customer message
- Generate captions + clip script → three pieces of text; costs credits
- Save carousel slides → images rendered in the browser from the identity and photos
**States to handle**: no avatar (show initial); upload too big / wrong type; out of credits when generating captions; staff member without edit rights.
**Business rules affecting UI**: only owners/admins edit; discount limit 0–50%.

### Catalogue
**Purpose**: The only source of products/prices the assistant may quote.
**Data I need to display**: each item's name, type, description, price, intro price (shown as a strikethrough), stock/places, photo, on-sale/off state.
**Actions**: add item; **change an item's price, intro price or stock**; turn on/off (never hard-delete, to keep past orders intact).
**States to handle**: empty catalogue; invalid price entry; intro price not lower than normal price.
**Business rules affecting UI**: only owners/admins edit; prices in naira.

### Customer chat (public)
**Purpose**: Customers talk to the assistant.
**Data I need to display**: assistant name, avatar or initial, colour, job title, business name, greeting, the running conversation (survives a refresh on the same device).
**Actions**: send a message → assistant reply, which may contain a checkout link.
**States to handle**: assistant typing; business out of credits / paused (polite message, no internal reason shown to the customer); rate-limited; network failure; unknown business address.

### Checkout (public, via unguessable link)
**Purpose**: Customer reviews and pays.
**Data I need to display**: business name, order reference, itemised lines, discount, total, payment deadline, which payment options exist (Paystack and/or bank details with account number and narration), the current status in plain words, whether a receipt is already under review.
**Actions**:
- Approve the order as correct → payment options appear
- Pay with Paystack (needs an email) → redirected to Paystack; on return, status refreshes after a real verification
- Upload a transfer receipt → status becomes "being checked"
**States to handle**: not yet approved; expired; paid; rejected (can try again); business hasn't set up payments; upload too large / wrong type; multiple pending receipts.
**Business rules affecting UI**: a receipt alone never shows "paid"; nothing can be paid before approval.

### Orders + order detail
**Purpose**: Follow and fulfil orders.
**Data I need to display**: list with reference, customer name/phone, status, total, created time; filter by status. Detail: items, discount, total, customer, approval time, pay-by time, payments with method and status, an audit history, and the chat that produced the order.
**Actions**: mark a paid order fulfilled.
**Business rules affecting UI**: fulfil only after payment confirmed; owners/admins only.

### Payments to check
**Purpose**: Verify bank transfers.
**Data I need to display**: each pending receipt (viewable privately, time-limited), the order it belongs to and expected amount, what was read from the receipt (amount, recipient, sender, bank, date, reference, status wording), and human-readable warnings (short amount, wrong account, wrong name, failed status, dated before the order, unreadable). Below: recent payments of all kinds.
**Actions**: approve with reason → order paid, payment recorded, audit entry; reject with reason → order marked rejected.
**States to handle**: nothing pending; already reviewed by a colleague; PDF receipts (open, not inline).

### Payment settings
**Purpose**: Where the business's own sales money goes.
**Data I need to display**: bank name, account number, account name, instructions, payment deadline; whether a Paystack secret is saved (never the key itself), public key, whether Paystack is offered; the webhook address to paste into Paystack.
**Actions**: save bank details (10-digit account number); save/replace Paystack keys; toggle Paystack.

### Usage & billing
**Purpose**: Understand and buy AI credits (separate from sales money).
**Data I need to display**: credits left, credits used this period, plan name/allowance/price, period end + status, usage by feature, last ~40 usage events (failed ones clearly "not charged"), credits added history, low-balance warning.
**Actions**: buy a credit pack → Paystack → credits appear only after verification; **upgrade to a paid plan**.

### Platform admin
**Purpose**: Platform owner controls cost and abuse.
**Data I need to display**: workspace count, paying subscriptions, estimated AI cost, top-up revenue, margin estimate, failed requests, per-workspace usage/cost/status. No conversation content.
**Actions**: AI on/off for everyone + daily cap; grant/remove credits with a reason; suspend/reactivate a workspace.

## Uncertainties
- [ ] Should a customer be notified (WhatsApp/SMS) the moment the owner approves a receipt, or is "ask the assistant" enough for this slice?
- [ ] Should expired checkouts be marked expired in storage, or only shown as expired?
- [ ] Is "upgrade plan" needed in this slice, or are top-ups enough while we have few customers?
- [ ] Guessing that one assistant per workspace is fine for now.

## Questions for Backend
- Should the chat link and checkout link be one domain, or could businesses bring their own?
- Would it make sense for receipt reading to skip PDFs entirely until we support them?
- Is there a simpler way to keep chat history on the customer's device without an account?

## Discussion Log
**2026-10-25 · backend review against what is built**
- ✅ Covered as described: onboarding, overview (real numbers only), assistant identity + launch kit, chat, checkout approval → Paystack / transfer, receipt review with audit, orders + fulfil, payment settings (secret never returned), usage & billing, platform admin.
- 🔧 Gap → fixed: **password reset** (forgot + set new password pages).
- 🔧 Gap → fixed: **editing catalogue price / intro price / stock** (existing orders keep their price).
- 🔧 Gap → fixed: **upgrade / renew a paid plan** from Usage & billing (price taken from the plans table, activated only after Paystack verification, 30-day period).
- 🔧 Found while reviewing: trial and plan end dates were not enforced → now blocked server-side (3-day grace for paid plans).
- Uncertainty "notify customer on approval": not in this slice; the customer sees it on the checkout page and the assistant reports it when asked. Revisit with WhatsApp.
- Uncertainty "expired checkouts": shown as expired, not rewritten in storage; fine for now.
- One assistant per workspace: confirmed for this slice.
- Live database verified on Supabase project `dall-ai` (eu-west-2): tenant isolation, trial credits, reserve/settle accounting, locked secrets, storage buckets.
