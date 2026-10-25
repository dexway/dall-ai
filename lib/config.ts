// Change the product name here; everything reads from this file.
export const BRAND = {
  name: "Dall AI",
  short: "Dall",
  tagline: "AI staff for Lagos businesses",
  supportEmail: "hello@dall.ai",
};

export const AI = {
  defaultModel: process.env.AI_MODEL || "claude-sonnet-5-5",
  receiptModel: process.env.AI_RECEIPT_MODEL || "claude-sonnet-5-5",
  maxToolCallsPerTurn: 5,
  requestTimeoutMs: 45_000,
  maxRetries: 1,
  maxHistoryMessages: 20,
  maxUserMessageChars: 2_000,
};

/** Credit packs a business can buy (platform billing, not the business's own sales). */
export const TOP_UPS = [
  // 1 credit costs Dall AI ~$0.01 of Claude usage (rate card credits_per_usd = 100). Re-check vs FX before launch.
  { id: "c500", credits: 500, amount_kobo: 1_200_000 },
  { id: "c2000", credits: 2000, amount_kobo: 4_400_000 },
  { id: "c6000", credits: 6000, amount_kobo: 12_000_000 },
];
