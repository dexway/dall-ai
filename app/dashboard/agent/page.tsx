import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWorkspace, canManage } from "@/lib/workspace";
import { publicAssetUrl, supabaseAdmin } from "@/lib/supabase/server";
import { BUILTIN_PRESETS } from "@/lib/presets";
import { extractText } from "@/lib/extract";
import Studio from "./Studio";
import AgentChannels from "./AgentChannels";
import { fetchPublicPage, checkUrlShape } from "@/lib/net-guard";
import LaunchKit from "./LaunchKit";

const KNOWLEDGE_CAP = 16000;
const MAX_DOC = 10 * 1024 * 1024;

export const metadata = { title: "Assistant studio" };

const LANGS = ["English", "Pidgin", "Yorùbá", "Igbo", "Hausa"];
const VOICES = ["lagos-english", "pidgin", "yoruba", "igbo", "hausa"];
const MAX_IMG = 4 * 1024 * 1024;

async function save(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/agent?error=role");
  const ws = ctx.workspace.id;
  const id = String(formData.get("id"));
  const langs = LANGS.filter((l) => formData.get(`lang_${l}`));
  const color = String(formData.get("accent_color") ?? "#C8EE72");
  const website = String(formData.get("website_url") ?? "").trim().slice(0, 300);
  const update: Record<string, unknown> = {
    name: String(formData.get("name") ?? "").trim().slice(0, 40) || "Amaka",
    role_title: String(formData.get("role_title") ?? "").trim().slice(0, 60) || "Sales & support assistant",
    persona: String(formData.get("persona") ?? "").trim().slice(0, 600),
    greeting: String(formData.get("greeting") ?? "").trim().slice(0, 300),
    instructions: String(formData.get("instructions") ?? "").trim().slice(0, 4000),
    website_url: website || null,
    languages: langs.length ? langs : ["English"],
    voice_style: VOICES.includes(String(formData.get("voice_style"))) ? formData.get("voice_style") : "lagos-english",
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

// Reads the business's website and stores a plain-text summary as the agent's knowledge.
async function learnFromWebsite(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/agent?error=role");
  const url = String(formData.get("website_url") ?? "").trim();
  try { checkUrlShape(url); } catch { redirect("/dashboard/agent?error=url"); }

  let text = "";
  try {
    // Public pages only: private/internal addresses are refused at connect time, redirects re-checked.
    const html = (await fetchPublicPage(url)).slice(0, 400000);
    text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim().slice(0, 4000);
  } catch { redirect("/dashboard/agent?error=fetch"); }
  if (!text) redirect("/dashboard/agent?error=fetch");

  await supabaseAdmin().from("agents").update({ website_url: url.slice(0, 300), knowledge: `From ${url}:\n${text}` })
    .eq("workspace_id", ctx.workspace.id);
  revalidatePath("/dashboard/agent");
  redirect("/dashboard/agent?saved=learned");
}

// Reads uploaded PDFs, Word docs, text or CSV files and adds their text to the agent's knowledge.
async function addKnowledgeFiles(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/agent?error=role");
  const files = formData.getAll("docs").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 5);
  if (!files.length) redirect("/dashboard/agent?error=nofile");

  const sections: string[] = [];
  for (const f of files) {
    if (f.size > MAX_DOC) redirect("/dashboard/agent?error=big");
    let text = "";
    try { text = await extractText(f.name, f.type, await f.arrayBuffer()); }
    catch { redirect("/dashboard/agent?error=doctype"); }
    if (text) sections.push(`From ${f.name}:\n${text.slice(0, 8000)}`);
  }
  if (!sections.length) redirect("/dashboard/agent?error=empty");

  const db = supabaseAdmin();
  const { data: cur } = await db.from("agents").select("knowledge").eq("workspace_id", ctx.workspace.id).order("created_at").limit(1).single();
  const merged = [cur?.knowledge?.trim(), ...sections].filter(Boolean).join("\n\n").slice(0, KNOWLEDGE_CAP);
  await db.from("agents").update({ knowledge: merged }).eq("workspace_id", ctx.workspace.id);
  revalidatePath("/dashboard/agent");
  redirect("/dashboard/agent?saved=docs");
}

async function clearKnowledge() {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/agent?error=role");
  await supabaseAdmin().from("agents").update({ knowledge: "" }).eq("workspace_id", ctx.workspace.id);
  revalidatePath("/dashboard/agent");
  redirect("/dashboard/agent?saved=cleared");
}

async function saveAsPreset(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/agent?error=role");
  const name = String(formData.get("preset_name") ?? "").trim().slice(0, 40);
  if (!name) redirect("/dashboard/agent?error=save");
  await supabaseAdmin().from("agent_presets").insert({
    workspace_id: ctx.workspace.id, name,
    persona: String(formData.get("persona") ?? "").slice(0, 600),
    greeting: String(formData.get("greeting") ?? "").slice(0, 300),
    instructions: String(formData.get("instructions") ?? "").slice(0, 4000),
  });
  revalidatePath("/dashboard/agent");
  redirect("/dashboard/agent?saved=preset");
}

export default async function AgentPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireWorkspace();
  const sp = await searchParams;
  const [{ data: a }, { data: presetRows }] = await Promise.all([
    ctx.db.from("agents").select("*").eq("workspace_id", ctx.workspace.id).order("created_at").limit(1).single(),
    ctx.db.from("agent_presets").select("id,name,persona,greeting,instructions").eq("workspace_id", ctx.workspace.id).order("created_at", { ascending: false }),
  ]);
  if (!a) return <div className="panel">No assistant found.</div>;
  const avatarUrl = publicAssetUrl(a.avatar_path);
  const images = (a.image_paths as string[]).map((p) => publicAssetUrl(p)!);
  const customPresets = (presetRows ?? []).map((p) => ({ key: p.id, label: p.name, emoji: "⭐", persona: p.persona, greeting: p.greeting, instructions: p.instructions }));
  const errors: Record<string, string> = { role: "Only owners and admins can change the assistant.", image: "Images must be PNG, JPG or WEBP under 4 MB.", upload: "An image failed to upload. Try again.", save: "Couldn't save. Try again.", url: "That website link doesn't look right. Use a full address like https://yourshop.com.", fetch: "Couldn't read that website. Check the link is public and try again.", nofile: "Choose a file to upload first.", big: "Each file must be under 10 MB.", doctype: "Use PDF, Word (.docx), text or CSV files. Old .doc files should be saved as .docx or PDF.", empty: "Couldn't find any text in that file. If it's a scanned image, type the details into the Knowledge box instead." };
  const saved: Record<string, string> = { "1": "Saved. Your assistant uses these settings from the next message.", learned: "Read your website. Check the Knowledge box and edit anything that's off.", preset: "Preset saved. It's in your preset list above.", docs: "Added your document to the assistant's memory.", cleared: "Cleared the learned knowledge." };

  return (
    <>
      <div className="page-head">
        <div><h1>Assistant studio</h1><p>Build your AI assistant: start from a preset, give it a personality and a brain, teach it from your website, and launch it everywhere.</p></div>
        <a className="btn btn-line" href={`/chat/${ctx.workspace.slug}`} target="_blank" rel="noreferrer">Test the chat ↗</a>
      </div>
      {sp.saved && saved[sp.saved] && <div className="notice notice-ok" role="status">{saved[sp.saved]}</div>}
      {sp.error && <div className="notice notice-bad" role="alert">{errors[sp.error] ?? "Something went wrong."}</div>}

      <Studio
        agent={{ id: a.id, name: a.name, role_title: a.role_title, persona: a.persona, greeting: a.greeting, instructions: a.instructions ?? "", website_url: a.website_url ?? null, knowledge: a.knowledge ?? "", accent_color: a.accent_color, max_discount_pct: Number(a.max_discount_pct), languages: a.languages, voice_style: a.voice_style }}
        avatarUrl={avatarUrl} builtinPresets={BUILTIN_PRESETS} customPresets={customPresets} initialPreset={sp.preset}
        save={save} learnFromWebsite={learnFromWebsite} saveAsPreset={saveAsPreset}
        addKnowledgeFiles={addKnowledgeFiles} clearKnowledge={clearKnowledge}
      />

      <div style={{ marginTop: 32 }}>
        <AgentChannels workspaceId={ctx.workspace.id} agentName={a.name} />
      </div>

      <div style={{ marginTop: 32 }}>
        <LaunchKit agent={{ name: a.name, role: a.role_title, color: a.accent_color, avatar: avatarUrl, languages: a.languages }}
          business={ctx.workspace.name} slug={ctx.workspace.slug} images={images} />
      </div>
    </>
  );
}
