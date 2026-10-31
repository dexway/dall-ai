"use server";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireWorkspace, canManage } from "@/lib/workspace";
import { supabaseAdmin } from "@/lib/supabase/server";
import { queueCultureResearch, runCultureTask, CultureLimitError } from "@/lib/culture/research";

// Creative Studio · Cultural Research actions. Separate from the Content Creator actions on purpose.

const back = (b: string, q: string) => redirect(`/dashboard/studio?${b ? `b=${encodeURIComponent(b)}&` : ""}tab=culture&${q}`);

export async function startCultureResearch(formData: FormData) {
  const ctx = await requireWorkspace();
  const b = String(formData.get("b") ?? "");
  if (!canManage(ctx)) back(b, "error=role");
  const topic = String(formData.get("topic") ?? "").trim().slice(0, 600);
  const depthRaw = String(formData.get("depth"));
  const depth = depthRaw === "quick" || depthRaw === "deep" ? depthRaw : "standard";
  const region = String(formData.get("region") ?? "Lagos").trim().slice(0, 80) || "Lagos";
  if (topic.length < 8) back(b, "error=ci_topic");
  let id: string;
  try { id = await queueCultureResearch({ workspaceId: ctx.workspace.id, userId: ctx.user.id, topic, region, depth }); }
  catch (e) { back(b, `error=ci_failed&why=${encodeURIComponent(e instanceof CultureLimitError ? e.message : "Couldn't start the research.")}`); return; }
  after(() => runCultureTask(id));
  back(b, `saved=ci_started&task=${id}`);
}

export async function retryCultureResearch(formData: FormData) {
  const ctx = await requireWorkspace();
  const b = String(formData.get("b") ?? "");
  if (!canManage(ctx)) back(b, "error=role");
  const id = String(formData.get("task") ?? "");
  const { data } = await supabaseAdmin().from("ci_research_tasks").select("id,status").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!data || data.status !== "failed") back(b, "error=ci_failed");
  after(() => runCultureTask(id));
  back(b, `saved=ci_started&task=${id}`);
}
