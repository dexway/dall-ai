// Harvey's pure parts: signals with evidence, contacts, one-tap send links, follow-up timing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSignals, extractContacts, mergeSignals, profileLinks, domainOf, mailtoLink, whatsappLink, followupDue, detectCompetitor } from "../lib/harvey/signals.ts";

const page = `<html><head><script async src="https://connect.facebook.net/en_US/fbevents.js"></script><script>fbq('init','123')</script></head><body>
  <h1>Bluewater Logistics</h1><p>We're hiring drivers and dispatch officers across Lagos.</p>
  <p>Our new branch in Ikeja is now open. A team of 120 staff serving 300 clients.</p>
  <p>Meet Adaeze Okafor, Managing Director, and Tunde Bello - Operations Manager.</p>
  <p>Contact us: <a href="mailto:hello@bluewater.ng">hello@bluewater.ng</a> or call <a href="tel:+234 803 123 4567">0803 123 4567</a>. Email sales@bluewater.ng</p>
  <img src="logo@2x.png"></body></html>`;

test("harvey signals: concrete evidence only", () => {
  const s = detectSignals(page, "https://bluewater.ng/");
  const keys = s.map((x) => x.key);
  assert.ok(keys.includes("RUNNING_META_ADS") && keys.includes("HIRING") && keys.includes("GROWING") && keys.includes("NO_ONLINE_BOOKING") && keys.includes("NO_WHATSAPP"));
  assert.ok(!keys.includes("RUNNING_GOOGLE_ADS"));
  assert.ok(s.find((x) => x.key === "HIRING")!.evidence.includes("hiring drivers"));
  assert.equal(s.find((x) => x.key === "TEAM_SIZE")!.label, "Team of about 120");
  // A booking widget or WhatsApp link on any page cancels the "missing" signals.
  const contact = `<a href="https://wa.me/2348031234567">Chat</a><a href="https://calendly.com/x">Book now</a>`;
  const merged = mergeSignals([{ html: page, signals: s }, { html: contact, signals: detectSignals(contact, "https://bluewater.ng/contact") }]);
  assert.ok(!merged.some((x) => x.key === "NO_WHATSAPP" || x.key === "NO_ONLINE_BOOKING"));
  assert.ok(merged.some((x) => x.key === "HIRING"));
});

test("harvey contacts: emails on their domain first, Nigerian phones, people with titles", () => {
  const c = extractContacts(page, "bluewater.ng");
  assert.deepEqual(c.emails, ["hello@bluewater.ng", "sales@bluewater.ng"]);
  assert.ok(!c.emails.some((e) => e.includes(".png")));
  assert.ok(c.phones.includes("+2348031234567"));
  assert.deepEqual(c.people.map((p) => [p.name, p.title]), [["Adaeze Okafor", "Managing Director"], ["Tunde Bello", "Operations Manager"]]);
  assert.deepEqual(extractContacts('<a href="https://wa.me/2348031234567">x</a>', null).whatsapp, ["2348031234567"]);
});

test("harvey helpers: links, domains, send links, follow-up timing", () => {
  assert.deepEqual(profileLinks(["https://a.ng/blog/x", "https://a.ng/contact-us", "https://a.ng/about", "https://a.ng/our-team", "https://a.ng/services"]), ["https://a.ng/contact-us", "https://a.ng/about", "https://a.ng/our-team"]);
  assert.equal(domainOf("https://www.Acme.ng/about"), "acme.ng"); assert.equal(domainOf("acme.ng"), "acme.ng"); assert.equal(domainOf(""), null);
  assert.equal(mailtoLink("a@b.ng", "Hi there", "Line 1\nLine 2"), "mailto:a%40b.ng?subject=Hi%20there&body=Line%201%0ALine%202");
  assert.equal(whatsappLink("0803 123 4567", "Hello"), "https://wa.me/2348031234567?text=Hello");
  const now = Date.parse("2026-11-10T09:00:00Z"), day = 86_400_000;
  const p = { stage: "contacted", updated_at: "2026-11-01T00:00:00Z" };
  assert.equal(followupDue(p, new Date(now - 4 * day).toISOString(), null, 3, now), true);
  assert.equal(followupDue(p, new Date(now - 2 * day).toISOString(), null, 3, now), false);
  assert.equal(followupDue(p, new Date(now - 4 * day).toISOString(), new Date(now - day).toISOString(), 3, now), false); // they replied
  assert.equal(followupDue({ ...p, stage: "replied" }, new Date(now - 9 * day).toISOString(), null, 3, now), false);
});

test("harvey competition: credit lines and links count, bare mentions don't", () => {
  const rivals = [{ id: "c1", name: "Mama Cass Catering", domain: "mamacass.ng", aliases: ["Mama Cass"] }, { id: "c2", name: "Eventful", domain: "eventful.com.ng", aliases: [] }];
  const credited = detectCompetitor("<footer>Our partners: Mama Cass, Zenith Bank</footer>", "https://acme.ng/", rivals);
  assert.equal(credited?.competitorId, "c1"); assert.equal(credited?.signal.key, "USES_COMPETITOR"); assert.ok(credited?.signal.evidence.includes("Mama Cass"));
  const catered = detectCompetitor("<p>Our staff lunches are catered by Mama Cass Catering every Friday.</p>", "https://acme.ng/about", rivals);
  assert.equal(catered?.signal.label, "Works with Mama Cass Catering");
  const linked = detectCompetitor('<a href="https://www.eventful.com.ng/portfolio">Events by Eventful</a>', "https://acme.ng/", rivals);
  assert.equal(linked?.competitorId, "c2"); assert.ok(linked?.signal.evidence.startsWith("Links to eventful.com.ng"));
  assert.equal(detectCompetitor("<p>We are nothing like Mama Cass Catering.</p>", "https://acme.ng/", rivals), null); // bare mention
  assert.equal(detectCompetitor("<p>Catered by Ma</p>", "https://acme.ng/", [{ id: "x", name: "Ma", domain: null, aliases: [] }]), null); // too short to trust
});

test("harvey gate (port of gate.py + writer.md rules): blocks AI tells, spam words, long and linky drafts", async () => {
  const { checkDraft } = await import("../lib/harvey/gate.ts");
  const good = checkDraft({ channel: "email", kind: "intro", subject: "your lekki hall bookings", body: "Saw the new Ikeja branch is open. Who handles the venue for your end of year party this December?\n\nTola, Watercress" });
  assert.deepEqual(good, { ok: true, reasons: [] });
  const bad = checkDraft({ channel: "email", kind: "intro", subject: "Quick Question", body: "I hope this email finds you well — we offer a game-changer! Visit https://x.ng. Interested? Free?" });
  assert.equal(bad.ok, false);
  for (const r of ["banned phrases", "no links in a first message", "em dash", "exclamation mark", 'starts with "I"', "subject should be lowercase", "more than one question"]) assert.ok(bad.reasons.some((x) => x.startsWith(r)), r);
  assert.ok(checkDraft({ channel: "whatsapp", kind: "intro", body: Array(70).fill("word").join(" ") }).reasons[0].startsWith("too long"));
  assert.ok(checkDraft({ channel: "email", kind: "followup", subject: "x", body: "Hi {{first_name}}, one thing" }).reasons.some((r) => r.startsWith("unfilled placeholders")));
});

test("harvey do-not-contact (port of gate.py): addresses with plus-tags, domains on a label boundary", async () => {
  const { dncEntry, dncMatch, dncDomainMatch } = await import("../lib/harvey/gate.ts");
  assert.equal(dncEntry("https://www.Acme.example/about"), "acme.example");
  assert.equal(dncEntry("mailto:Jane@acme.example"), "jane@acme.example");
  assert.equal(dncEntry("*.acme.example"), "acme.example");
  assert.equal(dncEntry("not a domain"), "");
  const list = ["acme.example", "jane@other.example"];
  assert.equal(dncMatch("bob@mail.acme.example", list), "acme.example");
  assert.equal(dncMatch("bob@notacme.example", list), "");
  assert.equal(dncMatch("jane+news@other.example", list), "jane@other.example");
  assert.equal(dncMatch("john@other.example", list), "");
  assert.equal(dncDomainMatch("other.example", list), ""); // one address doesn't bar the company
  assert.equal(dncDomainMatch("www.acme.example", list), "acme.example");
});

test("harvey skills: Harvey's prompts and skills load per agent, placeholders filled", async () => {
  const { HARVEY_PROMPTS, HARVEY_SKILLS, skillsFor, fill } = await import("../lib/harvey/harvey-skills.ts");
  assert.ok(HARVEY_PROMPTS.writer.includes("NEVER use em dashes"));
  assert.ok(HARVEY_SKILLS.objection_handling.length > 1000);
  const w = skillsFor("writer");
  assert.ok(w.startsWith("\n\n---\n## FOUNDATIONAL KNOWLEDGE") && w.includes(HARVEY_SKILLS.email_frameworks.slice(0, 40)) && !w.includes(HARVEY_SKILLS.objection_handling.slice(0, 40)));
  const sys = fill(HARVEY_PROMPTS.system, { company_name: "Watercress", product_description: "Event halls" });
  assert.ok(sys.includes("autonomous AI sales agent at Watercress") && sys.includes("Your product: Event halls") && !/\{\{\s*company_name/.test(sys));
  assert.ok(fill("Hi {{first_name}} at {{unknown}}", {}).startsWith("Hi {{first_name}} at "));
});

test("harvey competitors from OpenStreetMap: category from business type, well-known first, never itself", async () => {
  const { osmFilters, osmNoun, overpassQuery, rankPlaces, nominatimPlaces } = await import("../lib/harvey/osm.ts");
  assert.equal(osmNoun("Hotel"), "hotel"); assert.equal(osmNoun("Boutique hotel & suites"), "hotel"); assert.equal(osmNoun("Hair salon"), "salon");
  assert.equal(osmNoun("Software company"), ""); assert.deepEqual(osmFilters("Software company"), []);
  assert.ok(overpassQuery(osmFilters("Hotel"), [6.4, 3.3, 6.5, 3.5]).includes('nwr["tourism"~"^(hotel|guest_house|apartment|motel)$"]["name"](6.4,3.3,6.5,3.5);'));
  const ranked = rankPlaces([
    { tags: { name: "Small Inn" } },
    { tags: { name: "Federal Palace", wikidata: "Q1", website: "https://fp.ng" } },
    { tags: { name: "Watercress Suites", website: "https://watercress.com" } },
    { tags: { name: "Mid Hotel", website: "https://mid.ng", phone: "+234" } },
    { tags: { name: "Federal Palace" } },
  ], { name: "Watercress", domain: "watercress.com" });
  assert.deepEqual(ranked.map((p) => p.name), ["Federal Palace", "Mid Hotel", "Small Inn"]);
  // Nominatim: position in results counts, duplicate records merge (the website on the building record is kept).
  const places = nominatimPlaces([[
    { name: "Grand Hotel", category: "tourism", type: "hotel", importance: 0.001 },
    { name: "Lagos", category: "boundary", type: "administrative" },
    { name: "Eko Hotel", category: "tourism", type: "hotel", importance: 0.0001 },
    { name: "Eko Hotel", category: "building", type: "hotel", extratags: { website: "https://www.ekohotels.com/" } },
  ]], { name: "Watercress", domain: null });
  assert.deepEqual(places.map((p) => p.name), ["Eko Hotel", "Grand Hotel"]);
  assert.equal(places[0].website, "https://www.ekohotels.com/");
});
