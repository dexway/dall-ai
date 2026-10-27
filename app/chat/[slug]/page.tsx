import { notFound } from "next/navigation";
import { supabaseAdmin, publicAssetUrl } from "@/lib/supabase/server";
import { BRAND } from "@/lib/config";
import ChatBox from "./ChatBox";
import "../../public.css";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { data } = await supabaseAdmin().from("workspaces").select("name").eq("slug", slug).maybeSingle();
  return { title: data ? `Chat with ${data.name}` : "Chat" };
}

export default async function ChatPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = supabaseAdmin();
  const { data: ws } = await db.from("workspaces").select("id,name,status").eq("slug", slug).maybeSingle();
  if (!ws || ws.status !== "active") notFound();
  const { data: a } = await db.from("agents").select("name,role_title,greeting,avatar_path,accent_color").eq("workspace_id", ws.id).eq("active", true).order("created_at").limit(1).maybeSingle();
  if (!a) notFound();
  return (
    <main className="pub">
      <h1 style={{ position: "absolute", left: -9999 }}>Chat with {ws.name}</h1>
      <div className="pub-card">
        <ChatBox slug={slug} agent={{ name: a.name, role: a.role_title, greeting: a.greeting, avatar: publicAssetUrl(a.avatar_path), color: a.accent_color }} business={ws.name} />
        <p className="powered">AI assistant · replies may be checked by {ws.name} · powered by {BRAND.name}</p>
      </div>
    </main>
  );
}
