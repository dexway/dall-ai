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
