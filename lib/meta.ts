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

/** Sends a text reply on Messenger or Instagram. Free-form replies work inside 24 hours of the customer's last message. */
export async function sendMetaText(args: { pageToken: string; recipientId: string; text: string }): Promise<void> {
  const res = await fetch(`${graph()}/me/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.pageToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: args.recipientId }, message: { text: args.text.slice(0, 2000) }, messaging_type: "RESPONSE" }),
  });
  if (!res.ok) throw new Error(`meta send failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
