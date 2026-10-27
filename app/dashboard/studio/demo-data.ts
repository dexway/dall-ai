// Sample data for the Creative Director preview. Clearly labelled as DEMO in the UI; never used once
// the real tables exist. Brand: a Lagos party-food caterer (matches the landing page story).

const IMG = "https://xmjgpprmddptoldhrswj.supabase.co/storage/v1/object/public/brand-assets/site/hero";

export const demoBrand = {
  name: "Mama Put Kitchen",
  profile: {
    website: "https://mamaputkitchen.ng", industry: "Party food & small chops catering", location: "Surulere, Lagos",
    products: "Party jollof trays (serves 20/40), small chops boxes, asun, peppered turkey, zobo and chapman by the litre",
    audience: "Lagos women 25–45 planning birthdays, office parties, owambes and church events; busy professionals ordering for 20–100 guests",
    problems: "Caterers who arrive late, cold food, 'party jollof' that isn't smoky, hidden delivery fees",
    objectives: ["sales", "bookings", "awareness"], offers: "Party pack ₦85,000 (serves 40), small chops box ₦18,000 (serves 10)",
    differentiators: "Firewood-smoked jollof, on-time guarantee or 10% back, live tracking on WhatsApp",
    promotions: "December early-booking: 10% off orders placed 3 weeks ahead", voice: "Warm, confident Lagos auntie with jokes",
    language: "English with light Pidgin", tone: "Playful, appetising, never preachy", platforms: ["instagram", "tiktok", "whatsapp"],
    frequency: "4 posts + 3 reels a week", campaign_start: "2026-12-01", campaign_end: "2026-12-31",
    restrictions: "Only our real dishes, no staff faces without consent, one photo shoot a month", prohibited_claims: "No 'healthiest' or medical claims; no 'cheapest in Lagos'",
  },
  assets: 4,
};

export const demoAccounts = [
  { kind: "competitor", handle: "@chopsandmore.lagos", platform: "instagram", source: "user", accepted: true },
  { kind: "competitor", handle: "@partyjollofqueen", platform: "tiktok", source: "user", accepted: true },
  { kind: "competitor", handle: "@lekkismallchops", platform: "instagram", source: "user", accepted: true },
  { kind: "inspiration", handle: "@chefinlagos", platform: "instagram", source: "user", accepted: true },
  { kind: "inspiration", handle: "@sweetgreen", platform: "instagram", source: "user", accepted: true },
  { kind: "inspiration", handle: "@kilimanjaro_ng", platform: "instagram", source: "suggested", accepted: false, notes: "Strong Nigerian food brand content (found via a 2026 marketing roundup)" },
  { kind: "competitor", handle: "@ikejaeventcaterers", platform: "facebook", source: "suggested", accepted: false, notes: "Mainland caterer targeting office parties" },
];

export const demoSources = [
  { n: 1, title: "Lagos event catering prices rise as festive season approaches", host: "businessday.ng", age: "3 weeks ago" },
  { n: 2, title: "@partyjollofqueen — public profile (indexed posts)", host: "tiktok.com", age: "1 month ago" },
  { n: 3, title: "How Nigerians plan December parties: survey", host: "stears.co", age: "2 months ago" },
  { n: 4, title: "Chops & More — catering menu and packages", host: "chopsandmore.ng", age: "2 weeks ago" },
  { n: 5, title: "Short-form food video trends in West Africa, 2026", host: "techcabal.com", age: "5 weeks ago" },
  { n: 6, title: "Lekki Small Chops — Instagram highlights (indexed)", host: "instagram.com", age: "1 month ago" },
];

export const demoReport = {
  overview: { text: "Lagos party catering is crowded and price-led in December; buyers book 2–4 weeks ahead and decide on trust (punctuality, taste proof) more than price alone.", src: [1, 3], conf: "medium" },
  competitors: [
    { name: "Chops & More", handle: "@chopsandmore.lagos", positioning: "Premium Lekki events", formats: ["Carousels", "Event reels"], strengths: ["Polished event setups"], weaknesses: ["No prices shown", "Little behind-the-scenes"], cadence: "~4 posts/week (visible)", src: [4], conf: "medium" },
    { name: "Party Jollof Queen", handle: "@partyjollofqueen", positioning: "Personality-led, jollof-first", formats: ["Talking-head TikToks", "Taste reactions"], strengths: ["Strong founder voice", "Comment replies"], weaknesses: ["Inconsistent visuals", "No booking path"], cadence: "Daily (visible)", src: [2], conf: "medium" },
    { name: "Lekki Small Chops", handle: "@lekkismallchops", positioning: "Box deals for small parties", formats: ["Flat-lay photos", "Promo graphics"], strengths: ["Clear prices"], weaknesses: ["Generic stock-style photos", "Same promo every week"], cadence: "3 posts/week (visible)", src: [6], conf: "low" },
  ],
  formats: [{ text: "Short process videos (pot to plate) outperform static flat-lays in visible engagement across the accounts reviewed.", src: [5, 2], conf: "medium" }],
  needs: [{ text: "Hosts worry most about late delivery and food going cold, more than price.", src: [3], conf: "medium" }],
  trends: [{ date: "Oct 2026", text: "Festive catering prices up ~15–20% year on year, pushing 'value per head' messaging.", src: [1], conf: "medium" }, { date: "2026", text: "Smoke/firewood 'party jollof' ASMR clips are a rising format.", src: [5], conf: "low" }],
  gaps: [{ text: "No competitor shows live delivery tracking or an on-time promise: a clear, ownable trust angle.", src: [4, 6, 2], conf: "medium" }],
  overused: [{ text: "Generic 'Order now! DM for prices' graphics with stock party images.", src: [6], conf: "medium" }],
  positioning: { text: "‘The caterer that's on time, every time’: punctuality and firewood-smoked taste, proved on camera.", src: [3, 4], conf: "medium" },
  experiments: [{ idea: "Countdown reel: pot to party in 90 minutes", hypothesis: "Proof of timing drives more DMs than price posts", measure: "DMs per 1,000 views" }],
  limitations: ["Private analytics (reach, saves) aren't visible; engagement is judged from public counts only.", "Two Instagram profiles weren't indexed; findings for them rely on their websites."],
};

export const demoStrategy = {
  version: 2, status: "awaiting_approval",
  summary: "Win December by owning trust: be the caterer that's provably on time, with jollof you can almost smell through the screen.",
  positioning: "On time, every time — firewood-smoked party food for Lagos hosts who can't afford a late caterer.",
  pillars: [{ name: "Proof of punctuality", share: 35, purpose: "Turn the on-time promise into visible evidence" }, { name: "Taste & smoke", share: 30, purpose: "Make the food irresistible on screen" }, { name: "Host life", share: 20, purpose: "Relatable party-planning humour" }, { name: "Offers", share: 15, purpose: "Early-booking deal and packs" }],
  segments: [{ name: "Owambe planners", d: "Booking 40–100 guests, care about reputation" }, { name: "Office organisers", d: "Need invoices, punctuality, no drama" }],
  direction: "Documentary-real, warm firelight, real kitchen, real clocks on screen. No stock smiles, no generic party graphics.",
  visual: "Deep greens and ember orange; handheld close-ups; timestamps as a recurring graphic device.",
  tone: "Confident Lagos auntie: funny, warm, never preachy.",
  cadence: "4 feed posts + 3 reels + daily WhatsApp status",
  research: [{ decision: "Lead with punctuality", because: "No competitor makes an on-time promise; hosts fear lateness most", src: [3, 4] }, { decision: "Prioritise process reels", because: "Process video beats flat-lays in visible engagement", src: [5] }],
  rejected: [{ idea: "Weekly discount graphics", why: "Overused in this market and trains buyers to wait for deals" }, { idea: "Celebrity taste-test", why: "Out of budget, and borrowed trust" }],
};

export type DemoItem = { id: string; date: string; platform: string; format: string; pillar: string; status: string; hook: string; objective: string; insight: string; execution: string; action: string; evidence: string; src: number[]; caption: string; method: string; cost?: number; image?: string };

export const demoItems: DemoItem[] = [
  { id: "i1", date: "2026-12-02", platform: "tiktok", format: "short_video", pillar: "Proof of punctuality", status: "approved", hook: "It's 4:58pm. The party starts at 6. Watch.", objective: "Bookings", insight: "Hosts fear lateness more than price", execution: "Real-time countdown from pot to venue with on-screen timestamps", action: "DM 'DECEMBER' to book", evidence: "Research", src: [3, 4], caption: "Pot at 4:58. Guests eating at 5:52. That's the Mama Put promise 🔥⏱️ DM DECEMBER to book your date.", method: "video_shoot", cost: 0.56 },
  { id: "i2", date: "2026-12-04", platform: "instagram", format: "carousel", pillar: "Taste & smoke", status: "generated", hook: "Why our jollof tastes like a party (and theirs doesn't)", objective: "Awareness", insight: "'Party jollof' smokiness is the taste people chase", execution: "5-slide carousel: firewood, tomato base, the 'bottom pot' moment", action: "Save + share", evidence: "Hypothesis", src: [], caption: "Firewood. Patience. The bottom pot. 🔥 Save this for your next party.", method: "ai_image", cost: 0.0064, image: `${IMG}/jollof-trays.jpg` },
  { id: "i3", date: "2026-12-06", platform: "whatsapp", format: "story", pillar: "Offers", status: "awaiting_approval", hook: "3 weeks early = 10% off. Simple maths.", objective: "Sales", insight: "Buyers book 2–4 weeks ahead in December", execution: "Status with countdown sticker to the early-booking cutoff", action: "Reply to book", evidence: "Research", src: [3], caption: "Book 3 weeks ahead, save 10%. Party pack ₦85,000 → ₦76,500 💚", method: "graphic_design" },
  { id: "i4", date: "2026-12-09", platform: "instagram", format: "reel", pillar: "Host life", status: "awaiting_approval", hook: "POV: your caterer texts 'we're 10 minutes away' (they're not)", objective: "Engagement", insight: "Shared pain about late caterers is relatable", execution: "Comedy skit flipping to Mama Put's live-tracking message", action: "Tag a friend planning a party", evidence: "Research", src: [3], caption: "We send live tracking. Because 'on my way' is not a location 😂", method: "video_shoot" },
  { id: "i5", date: "2026-12-12", platform: "instagram", format: "static_image", pillar: "Taste & smoke", status: "revision_requested", hook: "This tray serves 40. It won't last 40 minutes.", objective: "Sales", insight: "Value per head matters as prices rise", execution: "Hero photo of a full party tray, price and serving count", action: "Tap to order", evidence: "Research", src: [1], caption: "Party pack · serves 40 · ₦85,000.", method: "ai_image", cost: 0.0032, image: `${IMG}/jollof-cooler.jpg` },
  { id: "i6", date: "2026-12-16", platform: "tiktok", format: "short_video", pillar: "Proof of punctuality", status: "draft", hook: "We've delivered 212 parties this year. Late: 0.", objective: "Bookings", insight: "Proof beats promises", execution: "Montage of delivery timestamps from real orders (with consent)", action: "Book your date", evidence: "Hypothesis", src: [], caption: "Receipts > promises.", method: "mixed" },
];

export const demoJobs = [
  { item: "i2", model: "Soul 2 (image)", status: "stored", cost: 0.0064, when: "Today 09:42" },
  { item: "i5", model: "Soul 2 (image)", status: "in_progress", cost: 0.0032, when: "Today 10:05" },
  { item: "i1", model: "Kling 3.0 (video)", status: "nsfw", cost: 0.56, when: "Yesterday 16:10", note: "Blocked by moderation (fire close-up). Not charged; budget released." },
];

export const demoUsage = [
  { label: "AI strategy & research (Claude)", used: 3.42, held: 0.6, limit: 20, money: true },
  { label: "Web searches", used: 38, held: 0, limit: 60, money: false },
  { label: "Images generated", used: 6, held: 1, limit: 40, money: false },
  { label: "Videos generated", used: 1, held: 0, limit: 5, money: false },
  { label: "Media generation spend (Higgsfield)", used: 0.0256, held: 0.0032, limit: 10, money: true },
];
