import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/workspace";
import { gatewayCall, GatewayError } from "@/lib/ai/gateway";

// Writes launch captions for the signed-in business. Metered like every other AI call.
export async function POST() {
  const ctx = await requireWorkspace();
  const { data: a } = await ctx.db.from("agents").select("id,name,role_title,persona,languages").eq("workspace_id", ctx.workspace.id).order("created_at").limit(1).single();
  if (!a) return NextResponse.json({ error: "No assistant found." }, { status: 404 });
  try {
    const res = await gatewayCall({
      workspaceId: ctx.workspace.id, feature: "launch_kit", agentId: a.id, userId: ctx.user.id, maxTokens: 700,
      system: "You write short, upbeat launch copy for small Nigerian businesses. Plain, specific, no hashtags spam (max 4), no false claims. Reply with JSON only.",
      messages: [{ role: "user", content:
        `Business: ${ctx.workspace.name} (${ctx.workspace.business_type ?? "small business"}, Lagos).
Their new AI assistant: ${a.name}, ${a.role_title}. Personality: ${a.persona}. Speaks: ${a.languages.join(", ")}.
Write JSON with keys:
- instagram: a caption announcing customers can now chat with ${a.name} any time to ask, order and pay (under 70 words)
- whatsapp_status: one or two lines for WhatsApp status, may include a light Pidgin touch if Pidgin is listed
- clip_script: a 15-second vertical video script with 3-4 timed shots (e.g. "0-3s:"), on-screen text and voiceover` }],
    });
    const text = res.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return NextResponse.json({ instagram: String(json.instagram ?? ""), whatsapp_status: String(json.whatsapp_status ?? ""), clip_script: String(json.clip_script ?? "") });
  } catch (e) {
    if (e instanceof GatewayError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Couldn't write captions this time. Try again." }, { status: 500 });
  }
}
