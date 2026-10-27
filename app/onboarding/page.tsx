import { redirect } from "next/navigation";
import { supabaseUser } from "@/lib/supabase/server";
import { BRAND } from "@/lib/config";
import "../(auth)/auth.css";

export const metadata = { title: "Set up your business" };

const TYPES = ["Food & drinks", "Beauty & salon", "Health & clinic", "Fashion & retail", "Real estate", "Events & tickets", "Logistics", "Education & training", "Professional services", "Other"];

function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 32) || "business";
}

async function create(formData: FormData) {
  "use server";
  const db = await supabaseUser();
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "Other");
  if (name.length < 2) redirect("/onboarding?error=name");
  const base = slugify(name);
  for (let i = 0; i < 5; i++) {
    const slug = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const { error } = await db.rpc("create_workspace", { p_name: name, p_slug: slug.length < 3 ? `${slug}-biz` : slug, p_type: type });
    if (!error) redirect("/dashboard/agent?welcome=1");
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
              <select id="type" name="type" className="input" defaultValue="Food & drinks">{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
            </label>
            <button className="btn btn-ink">Continue</button>
          </form>
          <p className="muted" style={{ fontSize: 14 }}>Free during early access.</p>
        </div>
      </main>
    </div>
  );
}
