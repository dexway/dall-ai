import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWorkspace, canManage } from "@/lib/workspace";
import { publicAssetUrl } from "@/lib/supabase/server";
import LaunchKit from "./LaunchKit";

export const metadata = { title: "Assistant & launch kit" };

const LANGS = ["English", "Pidgin", "Yorùbá", "Igbo", "Hausa"];
const VOICES = [
  { id: "lagos-english", label: "Lagos English" }, { id: "pidgin", label: "Pidgin" },
  { id: "yoruba", label: "Yorùbá" }, { id: "igbo", label: "Igbo" }, { id: "hausa", label: "Hausa" },
];
const MAX_IMG = 4 * 1024 * 1024;

async function save(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/agent?error=role");
  const ws = ctx.workspace.id;
  const id = String(formData.get("id"));
  const langs = LANGS.filter((l) => formData.get(`lang_${l}`));
  const color = String(formData.get("accent_color") ?? "#C8EE72");
  const update: Record<string, unknown> = {
    name: String(formData.get("name") ?? "").trim().slice(0, 40) || "Amaka",
    role_title: String(formData.get("role_title") ?? "").trim().slice(0, 60) || "Sales & support assistant",
    persona: String(formData.get("persona") ?? "").trim().slice(0, 600),
    greeting: String(formData.get("greeting") ?? "").trim().slice(0, 300),
    languages: langs.length ? langs : ["English"],
    voice_style: VOICES.some((v) => v.id === formData.get("voice_style")) ? formData.get("voice_style") : "lagos-english",
    accent_color: /^#[0-9a-f]{6}$/i.test(color) ? color : "#C8EE72",
    max_discount_pct: Math.min(50, Math.max(0, Number(formData.get("max_discount_pct") ?? 0) || 0)),
    updated_at: new Date().toISOString(),
  };

  const upload = async (file: File, kind: string) => {
    if (!file.size) return null;
    if (file.size > MAX_IMG || !/^image\/(png|jpeg|webp)$/.test(file.type)) redirect("/dashboard/agent?error=image");
    const path = `${ws}/agent/${kind}-${crypto.randomUUID()}.${file.type.split("/")[1]}`;
    const { error } = await ctx.db.storage.from("brand-assets").upload(path, file, { contentType: file.type });
    if (error) redirect("/dashboard/agent?error=upload");
    return path;
  };
  const avatar = formData.get("avatar");
  if (avatar instanceof File && avatar.size) update.avatar_path = await upload(avatar, "avatar");
  const imgs = formData.getAll("images").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 6);
  if (imgs.length) {
    const { data: cur } = await ctx.db.from("agents").select("image_paths").eq("id", id).single();
    const added = [];
    for (const f of imgs) added.push(await upload(f, "photo"));
    update.image_paths = [...added, ...(cur?.image_paths ?? [])].slice(0, 6);
  }

  const { error } = await ctx.db.from("agents").update(update).eq("id", id).eq("workspace_id", ws);
  if (error) redirect("/dashboard/agent?error=save");
  revalidatePath("/dashboard/agent");
  redirect("/dashboard/agent?saved=1");
}

export default async function AgentPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireWorkspace();
  const sp = await searchParams;
  const { data: a } = await ctx.db.from("agents").select("*").eq("workspace_id", ctx.workspace.id).order("created_at").limit(1).single();
  if (!a) return <div className="panel">No assistant found.</div>;
  const avatarUrl = publicAssetUrl(a.avatar_path);
  const images = (a.image_paths as string[]).map((p) => publicAssetUrl(p)!);
  const errors: Record<string, string> = { role: "Only owners and admins can change the assistant.", image: "Images must be PNG, JPG or WEBP under 4 MB.", upload: "An image failed to upload. Try again.", save: "Couldn't save. Try again." };

  return (
    <>
      <div className="page-head">
        <div><h1>{sp.welcome ? "Meet your assistant" : "Assistant & launch kit"}</h1><p>Give it a name, a face and a way of talking. Customers see this everywhere it replies.</p></div>
        <a className="btn btn-line" href={`/chat/${ctx.workspace.slug}`} target="_blank" rel="noreferrer">Test the chat ↗</a>
      </div>
      {sp.saved && <div className="notice notice-ok" role="status">Saved. Your assistant uses these settings from the next message.</div>}
      {sp.error && <div className="notice notice-bad" role="alert">{errors[sp.error] ?? "Something went wrong."}</div>}

      <div className="two">
        <form action={save} className="panel">
          <input type="hidden" name="id" value={a.id} />
          <h2>Identity</h2>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            {avatarUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={avatarUrl} alt="" className="thumb" style={{ width: 64, height: 64, borderRadius: "50%" }} />
              : <span className="thumb" style={{ width: 64, height: 64, borderRadius: "50%", display: "grid", placeItems: "center", background: a.accent_color, fontWeight: 800, fontSize: 24 }}>{a.name[0]}</span>}
            <label className="field" style={{ flex: 1 }}><span>Face / avatar</span><input id="avatar" type="file" name="avatar" accept="image/png,image/jpeg,image/webp" className="input" /></label>
          </div>
          <div className="form-grid">
            <label className="field"><span>Name</span><input id="name" name="name" className="input" defaultValue={a.name} maxLength={40} required /></label>
            <label className="field"><span>Job title</span><input id="role_title" name="role_title" className="input" defaultValue={a.role_title} maxLength={60} /></label>
          </div>
          <label className="field"><span>Personality</span><textarea id="persona" name="persona" className="input" defaultValue={a.persona} maxLength={600} /><small>How it talks. e.g. &quot;Warm and quick, a little playful, calls customers &apos;dear&apos;.&quot;</small></label>
          <label className="field"><span>First greeting</span><input id="greeting" name="greeting" className="input" defaultValue={a.greeting} maxLength={300} /></label>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}><span>Replies in</span>
            <div className="row-actions">{LANGS.map((l) => (
              <label key={l} className="chip" style={{ cursor: "pointer" }}><input id={`lang_${l}`} type="checkbox" name={`lang_${l}`} defaultChecked={a.languages.includes(l)} /> {l}</label>
            ))}</div>
            <small>English and Pidgin read naturally. Ask a native speaker to check Yorùbá, Igbo or Hausa greetings before launch.</small>
          </fieldset>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}><span>Voice for calls & voice notes</span>
            <div className="row-actions">{VOICES.map((v) => (
              <label key={v.id} className="chip" style={{ cursor: "pointer" }}><input id={`voice_${v.id}`} type="radio" name="voice_style" value={v.id} defaultChecked={a.voice_style === v.id} /> {v.label}</label>
            ))}</div>
            <small>Used once a voice channel is connected.</small>
          </fieldset>
          <div className="form-grid">
            <label className="field"><span>Brand colour</span><input id="accent_color" type="color" name="accent_color" defaultValue={a.accent_color} className="input" style={{ padding: 4 }} /></label>
            <label className="field"><span>Max discount it may give (%)</span><input id="max_discount_pct" type="number" name="max_discount_pct" min={0} max={50} step={1} defaultValue={a.max_discount_pct} className="input" /><small>Above this, it passes the request to you.</small></label>
          </div>
          <label className="field"><span>Your photos for the launch kit (up to 6)</span><input id="images" type="file" name="images" accept="image/png,image/jpeg,image/webp" multiple className="input" /></label>
          <button className="btn btn-ink">Save assistant</button>
        </form>

        <LaunchKit agent={{ name: a.name, role: a.role_title, color: a.accent_color, avatar: avatarUrl, languages: a.languages }}
          business={ctx.workspace.name} slug={ctx.workspace.slug} images={images} />
      </div>
    </>
  );
}
