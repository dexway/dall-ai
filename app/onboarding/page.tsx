import { redirect } from "next/navigation";
import { supabaseUser, supabaseAdmin } from "@/lib/supabase/server";
import { BRAND } from "@/lib/config";
import "../(auth)/auth.css";

export const metadata = { title: "Set up your business" };

// Suggestions only: owners can type any kind of business. Each maps to the closest ready-made assistant.
const TYPES: [string, string][] = [
  ["Restaurant & food", "food"], ["Bar, lounge & nightlife", "lounge"], ["Cakes, catering & events", "catering"],
  ["Hotel, shortlet & hospitality", "hotel"], ["Event centre & venue", "venue"], ["Travel, tours & car hire", "travel"],
  ["Gym & fitness", "gym"], ["Salon, spa & barbing", "salon"], ["Beauty & skincare", "beauty"],
  ["Clinic, pharmacy & health", "clinic"], ["Fashion & clothing", "fashion"], ["Phones & gadgets", "electronics"],
  ["Supermarket & provisions", "groceries"], ["Real estate & property", "realestate"], ["Logistics & delivery", "services"],
  ["Education & training", "services"], ["Professional services", "services"],
];
const KEYWORDS: [RegExp, string][] = [
  [/hotel|shortlet|apartment|guest ?house|resort|inn|airbnb|hospitality|lodg/i, "hotel"], [/gym|fitness|yoga|pilates|crossfit|trainer/i, "gym"],
  [/bar|lounge|club|nightlife|pub/i, "lounge"], [/restaurant|food|kitchen|eatery|cafe|buka/i, "food"], [/cake|cater|event planner|bakery/i, "catering"],
  [/venue|event cent|hall/i, "venue"], [/travel|tour|car hire|rental|visa|flight/i, "travel"], [/salon|spa|barb|nail|lash/i, "salon"],
  [/skin|beauty|cosmetic|makeup/i, "beauty"], [/clinic|pharm|hospital|health|dental|lab/i, "clinic"], [/fashion|cloth|boutique|shoe|wear/i, "fashion"],
  [/phone|gadget|electronic|laptop/i, "electronics"], [/supermarket|grocer|provision|mart/i, "groceries"], [/real estate|property|realtor/i, "realestate"],
];
const presetFor = (type: string) => TYPES.find(([t]) => t === type)?.[1] ?? KEYWORDS.find(([re]) => re.test(type))?.[1] ?? "general";

function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 32) || "business";
}

async function create(formData: FormData) {
  "use server";
  const db = await supabaseUser();
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "").trim().slice(0, 60) || "Other";
  const website = String(formData.get("website") ?? "").trim().slice(0, 300);
  if (name.length < 2) redirect("/onboarding?error=name");
  const base = slugify(name);
  for (let i = 0; i < 5; i++) {
    const slug = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: wsId, error } = await db.rpc("create_workspace", { p_name: name, p_slug: slug.length < 3 ? `${slug}-biz` : slug, p_type: type });
    // The website lets Dall AI prepare a launch video draft for them (offered in a dashboard pop-up).
    if (!error && website && wsId) await supabaseAdmin().from("workspaces").update({ business_profile: { website } }).eq("id", wsId);
    if (!error) redirect(`/dashboard/agent?welcome=1&preset=${presetFor(type)}`);
    if (!String(error.message).includes("duplicate")) redirect("/onboarding?error=save");
  }
  redirect("/onboarding?error=save");
}

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const db = await supabaseUser();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { count } = await db.from("workspace_members").select("*", { count: "exact", head: true }).eq("user_id", user.id);
  if (count) redirect("/dashboard");
  const { error } = await searchParams;
  return (
    <div className="auth">
      <aside className="auth-side">
        <span className="auth-logo"><span aria-hidden>d</span>{BRAND.name}</span>
        <h2 className="hide-sm">First, <em>tell us about your business.</em></h2>
        <p className="hide-sm" style={{ color: "var(--mint-70)" }}>Next you&apos;ll name your assistant and add what you sell.</p>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <h1>Your business</h1>
          {error && <div className="notice notice-bad" role="alert">{error === "name" ? "Enter your business name." : "We couldn't save that. Please try again."}</div>}
          <form action={create}>
            <label className="field"><span>Business name</span><input id="name" name="name" className="input" required minLength={2} maxLength={80} placeholder="e.g. Mama Put Kitchen" /></label>
            <label className="field"><span>What kind of business?</span>
              <input id="type" name="type" className="input" list="business-types" required maxLength={60} placeholder="Pick one or type your own, e.g. Hotel, Gym, Car wash" autoComplete="off" />
              <datalist id="business-types">{TYPES.map(([t]) => <option key={t} value={t} />)}</datalist>
              <small style={{ color: "var(--ink-70)" }}>Any business works. We&apos;ll start you with the closest ready-made assistant, and you can change everything.</small>
            </label>
            <label className="field"><span>Website or Instagram page (optional)</span><input name="website" className="input" maxLength={300} placeholder="yourshop.com" autoComplete="url" />
              <small style={{ color: "var(--ink-70)" }}>We&apos;ll use it to prepare a launch video for your business.</small></label>
            <button className="btn btn-ink">Continue</button>
          </form>
          <p className="muted" style={{ fontSize: 14 }}>Free during early access.</p>
        </div>
      </main>
    </div>
  );
}
