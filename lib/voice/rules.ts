// AI phone calls: pure rules (no network, no database) so they can be tested.

/** Countries Dall AI sells numbers in, as the telecom provider names them. */
export const VOICE_COUNTRIES = [["NG", "Nigeria"], ["GH", "Ghana"], ["KE", "Kenya"], ["ZA", "South Africa"], ["GB", "United Kingdom"], ["US", "United States"]] as const;
const DIAL: Record<string, string> = { NG: "234", GH: "233", KE: "254", ZA: "27", GB: "44", US: "1" };

/** Voices a business can pick, by Dall AI name. The provider voice behind each is chosen server-side. */
export const VOICES = [
  { id: "female_ng", label: "Adaeze · warm Nigerian female" },
  { id: "male_ng", label: "Tunde · calm Nigerian male" },
  { id: "female_neutral", label: "Grace · clear international female" },
  { id: "male_neutral", label: "Daniel · clear international male" },
] as const;
export type VoiceId = (typeof VOICES)[number]["id"];
export const isVoice = (v: string): v is VoiceId => VOICES.some((x) => x.id === v);

/**
 * A phone number in E.164 ("+2348012345678"), or null if it can't be one. Local Nigerian forms
 * ("0801 234 5678", "2348012345678") are accepted for the business's default country.
 */
export function toE164(raw: string, country = "NG"): string | null {
  const s = raw.trim();
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return null;
  let out: string;
  if (s.startsWith("+")) out = digits;
  else if (s.startsWith("00")) out = digits.slice(2);
  else if (digits.startsWith("0") && DIAL[country]) out = DIAL[country] + digits.slice(1);
  else if (DIAL[country] && digits.startsWith(DIAL[country])) out = digits;
  else if (DIAL[country] && digits.length <= 10) out = DIAL[country] + digits;
  else out = digits;
  return out.length >= 8 && out.length <= 15 ? `+${out}` : null;
}

/**
 * A pasted contact list → calls to queue. One contact per line: "number", "name, number" or
 * "number, name" (comma, tab or semicolon). Duplicates and bad numbers are reported, not dialled.
 */
export function parseContacts(text: string, country = "NG", max = 500): { contacts: { name: string | null; e164: string }[]; rejected: string[] } {
  const contacts: { name: string | null; e164: string }[] = [], rejected: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    if (/^(name|phone|number)\b/i.test(line)) continue;                 // a CSV header
    const parts = line.split(/[,;\t]/).map((p) => p.trim()).filter(Boolean);
    const numIdx = parts.findIndex((p) => /\d{6,}/.test(p.replace(/[\s()-]/g, "")));
    const e164 = numIdx >= 0 ? toE164(parts[numIdx], country) : null;
    if (!e164) { rejected.push(line.slice(0, 80)); continue; }
    if (seen.has(e164)) continue;
    seen.add(e164);
    const name = parts.filter((_, i) => i !== numIdx).join(" ").slice(0, 80) || null;
    contacts.push({ name, e164 });
    if (contacts.length >= max) break;
  }
  return { contacts, rejected };
}

/** How many more calls a running campaign may start now (concurrency slots and the owner's minutes cap). */
export function slotsFree(c: { max_concurrent: number; max_minutes: number; minutes_used: number }, active: number, avgMinutesPerCall = 2): number {
  const left = c.max_minutes - c.minutes_used;
  if (left < avgMinutesPerCall / 2) return 0;
  return Math.max(0, Math.min(c.max_concurrent - active, Math.floor(left / avgMinutesPerCall) || 1));
}

/** Provider call status → ours. */
export function callStatus(raw: string | null | undefined): "dialing" | "in_progress" | "completed" | "no_answer" | "busy" | "failed" | null {
  const s = String(raw ?? "").toLowerCase().replace(/[\s-]/g, "_");
  if (["initiated", "queued", "ringing", "dialing"].includes(s)) return "dialing";
  if (["answered", "in_progress", "active", "bridged"].includes(s)) return "in_progress";
  if (["completed", "ended", "hangup", "finished"].includes(s)) return "completed";
  if (["no_answer", "noanswer", "timeout", "customer_did_not_answer"].includes(s)) return "no_answer";
  if (s === "busy" || s === "customer_busy") return "busy";
  if (["failed", "error", "rejected", "canceled", "cancelled"].includes(s)) return "failed";
  return null;
}

/**
 * The voice agent's instructions, built from the business's chat assistant so the phone agent knows
 * the same products, prices and rules. Phone style: short sentences, no lists or emoji, one question at a time.
 */
export function voicePrompt(a: { agentName: string; businessName: string; persona: string; profile: string; knowledge: string; instructions: string; goal?: string }): string {
  return `You are ${a.agentName}, speaking on the phone for ${a.businessName}, a business in Nigeria.
Personality: ${a.persona || "warm, polite and helpful"}.
This is a voice call: speak in short, natural sentences, one idea at a time, and ask one question at a time. Never read out lists, links, emoji or symbols. Say prices in naira the way people say them ("one hundred and sixty thousand naira").
${a.goal ? `\nGoal of this call: ${a.goal}\n` : ""}
About the business:
${a.profile || "(not filled in)"}
${a.instructions ? `\nHow the owner wants you to work:\n${a.instructions}\n` : ""}
${a.knowledge ? `\nBusiness knowledge (from their website and documents; quote prices and details from here, never invent):\n${a.knowledge.slice(0, 12000)}\n` : ""}
Rules: never invent prices, availability or offers. Never ask for card numbers, PINs or passwords. If the person asks not to be called again, apologise, say they won't be called again, and end the call. If they want a person, say the team will call them back. Keep calls brief and polite.`;
}
