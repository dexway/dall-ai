// Turns Meta Marketing API failures into something an owner can act on. Pure, so it is unit-tested.

export type AdStep = "image" | "campaign" | "adset" | "creative" | "ad";

export const AD_STEPS: { step: AdStep; label: string }[] = [
  { step: "image", label: "Upload product photo" },
  { step: "campaign", label: "Create campaign" },
  { step: "adset", label: "Set budget & audience" },
  { step: "creative", label: "Build the ad" },
  { step: "ad", label: "Save paused ad" },
];

export type AdFailure = {
  step: AdStep;
  title: string;      // short headline
  message: string;    // what Meta said, in plain words
  fix: string;        // what the owner should do next
  ourBug: boolean;    // true when the request Dall AI sent was wrong, not the owner's account
  code?: number; subcode?: number;
  raw: string;        // technical details, shown collapsed
};

type MetaErr = { message?: string; code?: number; error_subcode?: number; error_user_title?: string; error_user_msg?: string };

function parseMeta(raw: string): MetaErr {
  const at = raw.indexOf("{");
  if (at < 0) return {};
  try { return (JSON.parse(raw.slice(at)) as { error?: MetaErr }).error ?? {}; } catch { return {}; }
}

// Request-format errors: Meta rejected a field Dall AI sent (or didn't send). Not the owner's fault.
const OUR_BUG_SUBCODES = new Set([4834011, 2490487, 1487390, 1885183, 2446885]);

export function explainAdError(step: AdStep, raw: string): AdFailure {
  const e = parseMeta(raw);
  const said = (e.error_user_msg || e.message || raw).replace(/\s+/g, " ").trim().slice(0, 400);
  const text = `${e.error_user_title ?? ""} ${said}`.toLowerCase();
  const base = { step, code: e.code, subcode: e.error_subcode, raw: raw.slice(0, 1500), message: said };

  if (e.code === 190) return { ...base, ourBug: false, title: "Facebook access expired",
    fix: "Go to Channels and click Refresh permissions, then try again." };
  if (e.code === 200 || e.code === 10 || e.code === 294 || /permission|not authorized|advertise/.test(text)) return { ...base, ourBug: false,
    title: "Dall AI isn't allowed to create ads yet",
    fix: "Go to Channels → Refresh permissions and allow every ads permission Facebook asks for (including managing ads for your Page). You must be an admin of the ad account and the Page." };
  if (/whatsapp/.test(text) && /(number|link|connect)/.test(text)) return { ...base, ourBug: false,
    title: "Your Page has no WhatsApp number linked",
    fix: "In Meta Business Suite open Settings → WhatsApp accounts and link your WhatsApp Business number to this Page — or choose Messenger as the destination." };
  if (/budget/.test(text) && /(low|minimum|at least|too small)/.test(text)) return { ...base, ourBug: false,
    title: "Daily budget is below Meta's minimum",
    fix: "Raise the daily budget and try again. The minimum depends on your ad account's currency." };
  if (/currency/.test(text)) return { ...base, ourBug: false,
    title: "Ad account currency problem",
    fix: "Use the ad account in Naira (NGN) for Nigerian ads, or set the budget in that account's currency." };
  if (step === "image") return { ...base, ourBug: false,
    title: "The product photo couldn't be used",
    fix: "Make sure this product has a clear JPG or PNG photo in your Catalogue, then try again." };
  if (e.error_subcode && OUR_BUG_SUBCODES.has(e.error_subcode) || (e.code === 100 && /invalid parameter/i.test(e.message ?? ""))) return { ...base, ourBug: true,
    title: e.error_user_title || "Meta rejected the ad settings Dall AI sent",
    fix: "This is a problem in Dall AI's ad builder, not your account. Nothing was charged and the half-made campaign was removed. Try again — if it repeats, tell us." };
  return { ...base, ourBug: false, title: e.error_user_title || "Meta couldn't create the ad",
    fix: "Try again in a minute. If it keeps failing, open Ads Manager — Meta often shows more detail there." };
}

const LEGACY_EDGE: Record<string, AdStep> = { campaigns: "campaign", adsets: "adset", adcreatives: "creative", ads: "ad", adimages: "image" };

/** Reads a stored campaign error: new JSON failures, or older "adsets create failed 400: {...}" strings. */
export function parseStoredFailure(stored: string | null | undefined): AdFailure | null {
  if (!stored) return null;
  try {
    const v = JSON.parse(stored) as AdFailure;
    if (v && v.step && v.title) return v;
  } catch { /* legacy text */ }
  const m = stored.match(/^(\w+) create failed/);
  return explainAdError(LEGACY_EDGE[m?.[1] ?? ""] ?? "campaign", stored);
}
