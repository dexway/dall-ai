import "server-only";

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
// A business boosts a product with a click-to-chat ad. Everything is created PAUSED,
// so no money is spent until the business turns it on in Ads Manager.

async function adPost(adAccountId: string, edge: string, token: string, body: Record<string, unknown>): Promise<{ id: string }> {
  const res = await fetch(`${graph()}/${adAccountId}/${edge}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${edge} create failed ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as { id: string };
}

export type AdDestination = "whatsapp" | "messenger" | "instagram";

const DEST: Record<AdDestination, { destination_type: string; cta: string }> = {
  whatsapp: { destination_type: "WHATSAPP", cta: "WHATSAPP_MESSAGE" },
  messenger: { destination_type: "MESSENGER", cta: "MESSAGE_PAGE" },
  instagram: { destination_type: "INSTAGRAM_DIRECT", cta: "INSTAGRAM_MESSAGE" },
};

/** Creates a click-to-chat campaign, ad set, creative and ad — all PAUSED. Returns the Meta ids. */
export async function launchClickToChatAd(args: {
  adAccountId: string; token: string; pageId: string; destination: AdDestination;
  name: string; message: string; dailyBudgetMinor: number; imageUrl?: string | null; countries?: string[];
}): Promise<{ campaignId: string; adsetId: string; creativeId: string; adId: string }> {
  const d = DEST[args.destination];

  const campaign = await adPost(args.adAccountId, "campaigns", args.token, {
    name: args.name, objective: "OUTCOME_ENGAGEMENT", special_ad_categories: [], status: "PAUSED",
  });

  const adset = await adPost(args.adAccountId, "adsets", args.token, {
    name: args.name, campaign_id: campaign.id, daily_budget: args.dailyBudgetMinor,
    billing_event: "IMPRESSIONS", optimization_goal: "CONVERSATIONS",
    destination_type: d.destination_type, promoted_object: { page_id: args.pageId },
    targeting: { geo_locations: { countries: args.countries ?? ["NG"] } },
    status: "PAUSED",
  });

  const creative = await adPost(args.adAccountId, "adcreatives", args.token, {
    name: args.name,
    object_story_spec: {
      page_id: args.pageId,
      link_data: {
        message: args.message,
        link: `https://facebook.com/${args.pageId}`,
        ...(args.imageUrl ? { picture: args.imageUrl } : {}),
        call_to_action: { type: d.cta },
      },
    },
  });

  const ad = await adPost(args.adAccountId, "ads", args.token, {
    name: args.name, adset_id: adset.id, creative: { creative_id: creative.id }, status: "PAUSED",
  });

  return { campaignId: campaign.id, adsetId: adset.id, creativeId: creative.id, adId: ad.id };
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
