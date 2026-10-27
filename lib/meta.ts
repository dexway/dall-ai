import "server-only";
import { explainAdError, type AdFailure, type AdStep } from "@/lib/ad-errors";

// Meta Graph API calls for Embedded Signup (a business connects its own WhatsApp number through Meta's login).
const graph = () => `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || "v26.0"}`;

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See README → Meta setup.`);
  return v;
}

/** Swaps the one-time code from the Meta login for a business access token. */
export async function exchangeEmbeddedSignupCode(code: string): Promise<string> {
  const u = new URL(`${graph()}/oauth/access_token`);
  u.searchParams.set("client_id", need("NEXT_PUBLIC_META_APP_ID"));
  u.searchParams.set("client_secret", need("META_APP_SECRET"));
  u.searchParams.set("code", code);
  const res = await fetch(u);
  if (!res.ok) throw new Error(`token exchange failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("token exchange returned no access token");
  return json.access_token;
}

/** Subscribes this app to the business's WhatsApp account so Meta sends its messages to our webhook. */
export async function subscribeWaba(token: string, wabaId: string): Promise<void> {
  const res = await fetch(`${graph()}/${wabaId}/subscribed_apps`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`subscribe failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Reads the number's public name so the dashboard can show which number is connected. */
export async function phoneNumberInfo(token: string, phoneNumberId: string): Promise<{ display_phone_number?: string; verified_name?: string }> {
  const res = await fetch(`${graph()}/${phoneNumberId}?fields=display_phone_number,verified_name`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`phone lookup failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Swaps a Facebook Login code for a user token. The redirect URI must match the one used to start the login. */
export async function exchangeFacebookCode(code: string, redirectUri: string): Promise<string> {
  const u = new URL(`${graph()}/oauth/access_token`);
  u.searchParams.set("client_id", need("NEXT_PUBLIC_META_APP_ID"));
  u.searchParams.set("client_secret", need("META_APP_SECRET"));
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("code", code);
  const res = await fetch(u);
  if (!res.ok) throw new Error(`facebook token exchange failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("facebook token exchange returned no access token");
  return json.access_token;
}

/** Swaps a short-lived user token for a long-lived one (~60 days), so saved ad access keeps working. */
export async function longLivedToken(shortToken: string): Promise<string> {
  const u = new URL(`${graph()}/oauth/access_token`);
  u.searchParams.set("grant_type", "fb_exchange_token");
  u.searchParams.set("client_id", need("NEXT_PUBLIC_META_APP_ID"));
  u.searchParams.set("client_secret", need("META_APP_SECRET"));
  u.searchParams.set("fb_exchange_token", shortToken);
  const res = await fetch(u);
  if (!res.ok) throw new Error(`long-lived token exchange failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("long-lived token exchange returned no access token");
  return json.access_token;
}

/** Which permissions the person actually granted (they can untick some on Meta's screen). */
export async function listPermissions(userToken: string): Promise<{ granted: string[]; declined: string[] }> {
  const res = await fetch(`${graph()}/me/permissions`, { headers: { Authorization: `Bearer ${userToken}` } });
  if (!res.ok) return { granted: [], declined: [] };
  const rows = ((await res.json()) as { data?: { permission: string; status: string }[] }).data ?? [];
  return { granted: rows.filter((r) => r.status === "granted").map((r) => r.permission), declined: rows.filter((r) => r.status !== "granted").map((r) => r.permission) };
}

export type MetaAdAccount = { id: string; name?: string; currency?: string; account_status?: number };

/** Lists the ad accounts the person manages, so the business can pick which one Dall AI runs ads on. */
export async function listAdAccounts(userToken: string): Promise<MetaAdAccount[]> {
  const u = new URL(`${graph()}/me/adaccounts`);
  u.searchParams.set("fields", "id,name,currency,account_status");
  u.searchParams.set("limit", "100");
  const res = await fetch(u, { headers: { Authorization: `Bearer ${userToken}` } });
  if (!res.ok) throw new Error(`list ad accounts failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { data?: MetaAdAccount[] }).data ?? [];
}

export type MetaPage = { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } };

/** Lists the Pages the person granted, each with its own Page token and any linked Instagram account. */
export async function listPages(userToken: string): Promise<MetaPage[]> {
  const u = new URL(`${graph()}/me/accounts`);
  u.searchParams.set("fields", "id,name,access_token,instagram_business_account{id,username}");
  u.searchParams.set("limit", "100");
  const res = await fetch(u, { headers: { Authorization: `Bearer ${userToken}` } });
  if (!res.ok) throw new Error(`list pages failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { data?: MetaPage[] }).data ?? [];
}

/** Turns on message webhooks for a Page, so its Messenger and Instagram DMs reach our webhook. */
export async function subscribePage(pageToken: string, pageId: string): Promise<void> {
  const u = new URL(`${graph()}/${pageId}/subscribed_apps`);
  u.searchParams.set("subscribed_fields", "messages,messaging_postbacks");
  const res = await fetch(u, { method: "POST", headers: { Authorization: `Bearer ${pageToken}` } });
  if (!res.ok) throw new Error(`subscribe page failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// ---- Ads (Marketing API) ----
// A business boosts a product with a click-to-chat ad. Everything is created PAUSED, so no money is
// spent until the business turns it on in Ads Manager. If any step fails, the half-made campaign is
// deleted and the failure is explained step by step (see lib/ad-errors.ts).

export class AdStepError extends Error {
  constructor(public failure: AdFailure) { super(`${failure.step}: ${failure.title}`); }
}

async function adCall(step: AdStep, url: string, token: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch (e) {
    throw new AdStepError(explainAdError(step, `network error: ${(e as Error).message}`));
  }
  const text = await res.text();
  if (!res.ok) throw new AdStepError(explainAdError(step, text));
  return JSON.parse(text) as Record<string, unknown>;
}

export type AdDestination = "whatsapp" | "messenger" | "instagram";

// What each destination needs on the ad set and in the creative's button.
const DEST: Record<AdDestination, { destination_type: string; cta: string; app_destination: string; link: string }> = {
  whatsapp: { destination_type: "WHATSAPP", cta: "WHATSAPP_MESSAGE", app_destination: "WHATSAPP", link: "https://api.whatsapp.com/send" },
  messenger: { destination_type: "MESSENGER", cta: "MESSAGE_PAGE", app_destination: "MESSENGER", link: "https://fb.com/messenger_doc/" },
  instagram: { destination_type: "INSTAGRAM_DIRECT", cta: "INSTAGRAM_MESSAGE", app_destination: "INSTAGRAM_DIRECT", link: "https://www.instagram.com/" },
};

export type AdTargeting = { countries?: string[]; ageMin?: number; ageMax?: number; genders?: number[] };

/** Creates a click-to-chat campaign, ad set, creative and ad — all PAUSED. Returns the Meta ids. */
export async function launchClickToChatAd(args: {
  adAccountId: string; token: string; pageId: string; destination: AdDestination;
  name: string; headline: string; message: string; dailyBudgetMinor: number; imageUrl?: string | null; targeting?: AdTargeting;
  endTime?: string | null;
}): Promise<{ campaignId: string; adsetId: string; creativeId: string; adId: string }> {
  const d = DEST[args.destination];
  const t = args.targeting ?? {};
  const targeting: Record<string, unknown> = { geo_locations: { countries: t.countries ?? ["NG"] } };
  if (t.ageMin) targeting.age_min = t.ageMin;
  if (t.ageMax) targeting.age_max = t.ageMax;
  if (t.genders && t.genders.length) targeting.genders = t.genders;
  const acct = `${graph()}/${args.adAccountId}`;

  // 1. Meta needs the photo uploaded to the ad account; it returns a hash the creative refers to.
  if (!args.imageUrl) throw new AdStepError(explainAdError("image", "This product has no photo."));
  let imageHash: string;
  try {
    const img = await fetch(args.imageUrl);
    if (!img.ok) throw new Error(`photo download ${img.status}`);
    const bytes = Buffer.from(await img.arrayBuffer()).toString("base64");
    const up = await adCall("image", `${acct}/adimages`, args.token, { bytes });
    const first = Object.values((up.images ?? {}) as Record<string, { hash?: string }>)[0];
    if (!first?.hash) throw new AdStepError(explainAdError("image", JSON.stringify(up)));
    imageHash = first.hash;
  } catch (e) {
    if (e instanceof AdStepError) throw e;
    throw new AdStepError(explainAdError("image", (e as Error).message));
  }

  // 2. Campaign. Budget lives on the ad set, so budget sharing is off (Meta requires the field).
  const campaign = await adCall("campaign", `${acct}/campaigns`, args.token, {
    name: args.name, objective: "OUTCOME_ENGAGEMENT", special_ad_categories: [], status: "PAUSED",
    is_adset_budget_sharing_enabled: false,
  });
  const campaignId = String(campaign.id);

  try {
    // 3. Ad set: budget, audience and the chat destination. Lowest-cost bidding needs no bid amount.
    const adset = await adCall("adset", `${acct}/adsets`, args.token, {
      name: args.name, campaign_id: campaignId, daily_budget: args.dailyBudgetMinor,
      billing_event: "IMPRESSIONS", optimization_goal: "CONVERSATIONS", bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      destination_type: d.destination_type, promoted_object: { page_id: args.pageId },
      targeting, status: "PAUSED", ...(args.endTime ? { end_time: args.endTime } : {}),
    });

    // 4. Creative: photo, text and the chat button.
    const creative = await adCall("creative", `${acct}/adcreatives`, args.token, {
      name: args.name,
      object_story_spec: {
        page_id: args.pageId,
        link_data: {
          image_hash: imageHash, link: d.link, name: args.headline.slice(0, 40), message: args.message,
          call_to_action: { type: d.cta, value: { app_destination: d.app_destination } },
        },
      },
    });

    // 5. The ad itself, paused.
    const ad = await adCall("ad", `${acct}/ads`, args.token, {
      name: args.name, adset_id: String(adset.id), creative: { creative_id: String(creative.id) }, status: "PAUSED",
    });
    return { campaignId, adsetId: String(adset.id), creativeId: String(creative.id), adId: String(ad.id) };
  } catch (e) {
    // Don't leave a half-built campaign in the owner's Ads Manager.
    await fetch(`${graph()}/${campaignId}`, { method: "DELETE", headers: { Authorization: `Bearer ${args.token}` } }).catch(() => {});
    throw e;
  }
}

/** Reads spend and messaging results for a campaign, so the dashboard shows Naira-in vs chats-out. */
export async function campaignInsights(campaignId: string, token: string): Promise<{ spend?: string; results?: string; impressions?: string }> {
  const u = new URL(`${graph()}/${campaignId}/insights`);
  u.searchParams.set("fields", "spend,impressions,actions");
  const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return {};
  const row = ((await res.json()) as { data?: Array<{ spend?: string; impressions?: string; actions?: Array<{ action_type: string; value: string }> }> }).data?.[0];
  if (!row) return {};
  const conv = row.actions?.find((a) => a.action_type.includes("messaging_conversation") || a.action_type.includes("onsite_conversion.messaging"));
  return { spend: row.spend, impressions: row.impressions, results: conv?.value };
}

/** Sends a text reply on Messenger or Instagram. Free-form replies work inside 24 hours of the customer's last message. */
export async function sendMetaText(args: { pageToken: string; recipientId: string; text: string }): Promise<void> {
  const res = await fetch(`${graph()}/me/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.pageToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: args.recipientId }, message: { text: args.text.slice(0, 2000) }, messaging_type: "RESPONSE" }),
  });
  if (!res.ok) throw new Error(`meta send failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
