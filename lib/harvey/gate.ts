// Harvey's deterministic pre-send gate, ported from harvey/gate.py (github.com/ethanplusai/harvey, MIT,
// see HARVEY_LICENSE) plus the hard rules of its prompts/writer.md that code can check. Prompts are a
// floor, not a guarantee: every draft passes these checks before the owner can send it, and a failed
// draft says why.

export const BANNED_PHRASES = [
  "act now", "buy now", "click here", "click below", "limited time", "limited offer", "exclusive deal", "special offer",
  "risk-free", "no obligation", "100% free", "make money", "double your", "guaranteed results", "winner", "congratulations",
  "i hope this finds you well", "hope this email finds you well", "i hope this email finds you", "picture this", "what if i told you",
  "in today's fast-paced world", "game-changer", "game changer", "cutting-edge solution", "revolutionize your", "unlock your",
  "supercharge your", "as an ai", "i'm an ai", "i am an ai", "as a language model",
  // writer.md rules 2 and 7
  "here's what i keep seeing", "imagine if", "i'd love to", "just wanted to", "reaching out because", "just following up",
  "hope you're doing well", "i know you're busy", "worth a quick look", "worth a quick chat", "worth a quick call", "quick question",
] as const;

const MAX_SUBJECT_LEN = 90, MAX_BODY_WORDS = 220, MAX_LINKS = 1;
const WORD_LIMIT: Record<string, number> = { intro: 75, followup: 75, reply: 150, proposal: 400, whatsapp: 60 };
const MERGE_TAG = /\{\{\s*\w+\s*\}\}|\{\s*\w+\s*\}(?!\})/g;
const URL_RE = /https?:\/\/\S+|\bwww\.\S+/gi;

export type GateResult = { ok: boolean; reasons: string[] };

/** Checks one outgoing message. `kind` is intro/followup/reply/proposal; WhatsApp drafts use the WhatsApp limit. */
export function checkDraft(m: { channel: "email" | "whatsapp" | string; kind: string; subject?: string | null; body: string }): GateResult {
  const reasons: string[] = [];
  const subject = (m.subject ?? "").trim(), body = (m.body ?? "").trim();
  const isEmail = m.channel === "email";
  if (!body) reasons.push("empty message");
  if (isEmail && !subject) reasons.push("empty subject");
  if (subject.length > MAX_SUBJECT_LEN) reasons.push(`subject too long (${subject.length} > ${MAX_SUBJECT_LEN})`);
  const words = body.split(/\s+/).filter(Boolean).length;
  const limit = Math.min(MAX_BODY_WORDS, isEmail ? WORD_LIMIT[m.kind] ?? MAX_BODY_WORDS : m.kind === "proposal" ? 250 : WORD_LIMIT.whatsapp);
  if (words > limit) reasons.push(`too long (${words} words, limit ${limit})`);
  const tags = (subject + " " + body).match(MERGE_TAG);
  if (tags) reasons.push(`unfilled placeholders: ${[...new Set(tags)].slice(0, 3).join(", ")}`);
  const lowered = (subject + " " + body).toLowerCase().replace(/[’‘]/g, "'");
  const hits = BANNED_PHRASES.filter((p) => lowered.includes(p));
  if (hits.length) reasons.push(`banned phrases: ${hits.slice(0, 3).join(", ")}`);
  if ((body.match(URL_RE) ?? []).length > (m.kind === "intro" ? 0 : MAX_LINKS)) reasons.push(m.kind === "intro" ? "no links in a first message" : "too many links");
  if (/<\s*(html|body|div|table|img|a)\b/i.test(body)) reasons.push("HTML in a plain-text message");
  if (body.includes("—")) reasons.push("em dash");
  if (/!/.test(body + subject)) reasons.push("exclamation mark");
  if (isEmail && m.kind !== "proposal" && /^(I|We)\b/.test(body.replace(/^(hi|hello|dear|good (morning|afternoon|evening))[^,\n]*[,\n]\s*/i, ""))) reasons.push('starts with "I" or "We"');
  if (isEmail && m.kind === "intro" && subject && subject !== subject.toLowerCase()) reasons.push("subject should be lowercase");
  if ((body.match(/\?/g) ?? []).length > (m.kind === "proposal" ? 3 : 1)) reasons.push("more than one question");
  if (/\b(re|fwd?):/i.test(subject) && m.kind !== "reply") reasons.push('fake "Re:" or "Fwd:" subject');
  return { ok: reasons.length === 0, reasons };
}

/** A do-not-contact entry (address or domain) from whatever was pasted, or "". Port of do_not_contact_entry. */
export function dncEntry(raw: string): string {
  let e = String(raw ?? "").normalize("NFKC").replace(/[­​-‍⁠﻿]/g, "").trim().toLowerCase();
  e = e.replace(/^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:)/, "").split(/[/?#]/)[0].replace(/^(?:\*@|\*\.|@)/, "");
  const domainOk = (d: string) => { d = d.split(":")[0].replace(/^\.+|\.+$/g, "").replace(/^www\./, ""); return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(d) ? d : ""; };
  if (e.includes("@")) { const i = e.lastIndexOf("@"); const local = e.slice(0, i), d = domainOk(e.slice(i + 1)); return d && /^[a-z0-9._%+'-]+$/.test(local) ? `${local}@${d}` : ""; }
  return domainOk(e);
}

/** The entry an address matches: addresses with plus-tags, domains on a label boundary. Port of do_not_contact_match. */
export function dncMatch(to: string, entries: string[]): string {
  const address = (to ?? "").trim().toLowerCase();
  if (!address.includes("@")) return "";
  const i = address.lastIndexOf("@"), local = address.slice(0, i), host = address.slice(i + 1).replace(/^www\./, "");
  for (const raw of entries) {
    const entry = dncEntry(raw);
    if (!entry) continue;
    if (entry.includes("@")) { const j = entry.lastIndexOf("@"); if (entry.slice(j + 1) === host && [local, local.split("+")[0]].includes(entry.slice(0, j))) return entry; }
    else if (host === entry || host.endsWith("." + entry)) return entry;
  }
  return "";
}

/** Same, for a prospect's domain: only domain entries bar a whole company. Port of do_not_contact_domain_match. */
export function dncDomainMatch(domain: string | null, entries: string[]): string {
  const host = (domain ?? "").trim().toLowerCase().replace(/^www\./, "");
  if (!host || host.includes("@")) return "";
  for (const raw of entries) { const e = dncEntry(raw); if (e && !e.includes("@") && (host === e || host.endsWith("." + e))) return e; }
  return "";
}

/** Harvey's reply intents (handler.py). The last three never get a drafted answer. */
export const INTENTS = ["interested", "question", "objection", "wrong_person", "meeting", "not_interested", "unsubscribe", "angry_legal"] as const;
export type Intent = (typeof INTENTS)[number];
export const NO_REPLY: readonly Intent[] = ["not_interested", "unsubscribe", "angry_legal"];
