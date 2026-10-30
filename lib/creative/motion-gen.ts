// Turns an approved motion plan into Higgsfield generation lines (pure, testable). Each planned photo
// edit becomes an image edit of the real photo; each scene becomes a clip: the real photo animated when
// the scene has one, text-to-video for graphics-only launch scenes. Models are picked by the router.
import type { MotionPack } from "./motion.ts";
import { chooseModel, TASKS, type Task } from "./router.ts";
import { estimateCost, type ModelRow } from "./rules.ts";

export type MotionLine = {
  key: string;               // "edit:0", "scene:2": stable per plan version, used in the idempotency key
  label: string;
  task: Task;
  model: ModelRow;
  fallback: boolean;
  estimate: number;
  spec: {
    objective: string; prompt: string; negative: string; aspect_ratio: "9:16" | "1:1" | "16:9" | "4:5";
    duration_seconds?: number; resolution: string; reference_asset_paths: string[]; variations: number; output: "image" | "video"; scenes: never[];
  };
};

const MAX_EDITS = 3;
const BEAT: Record<string, string> = { hook: "Hook", problem: "Desire", space: "The new thing", payoff: "Payoff", cta: "Logo + CTA" };

/** Every line the plan needs, with the best enabled model and its price; problems say what's missing. */
export function planMotionGeneration(pack: MotionPack, models: ModelRow[]): { lines: MotionLine[]; problems: string[] } {
  const lines: MotionLine[] = [], problems: string[] = [];
  const aspect = pack.storyboard.aspect_ratio;
  const add = (key: string, label: string, task: Task, spec: MotionLine["spec"]) => {
    const pick = chooseModel(task, models);
    if (!pick) { problems.push(`${label}: no ${TASKS[task].label.toLowerCase()} model is enabled yet.`); return; }
    // A model without an image input can't use the real photo: say so rather than silently inventing the space.
    if (TASKS[task].needsReference && !pick.model.image_param) { problems.push(`${label}: the enabled ${TASKS[task].label.toLowerCase()} model can't take your photo.`); return; }
    const finalSpec = { ...spec, duration_seconds: pick.model.kind === "video" ? Math.min(spec.duration_seconds ?? 5, pick.model.max_seconds ?? 10) : undefined };
    lines.push({ key, label, task, model: pick.model, fallback: pick.fallback, spec: finalSpec, estimate: estimateCost(pick.model, finalSpec) });
  };

  pack.enhancements.slice(0, MAX_EDITS).forEach((e, i) => add(`edit:${i}`, `Photo edit ${i + 1}${e.concept ? " (concept)" : ""}`, "photo_edit", {
    objective: e.direction, aspect_ratio: (e.crops[0] ?? aspect), resolution: "", variations: 1, output: "image", scenes: [],
    prompt: `${e.prompt}${e.keep_unchanged ? `\nKeep exactly as in the photo: ${e.keep_unchanged}.` : ""}`.slice(0, 2500),
    negative: e.negative, reference_asset_paths: [e.source_path],
  }));

  pack.storyboard.scenes.forEach((s, i) => {
    const seconds = Math.max(2, Math.round(s.end - s.start));
    add(`scene:${i}`, `Scene ${i + 1} · ${BEAT[s.beat] ?? s.beat} (${seconds}s)`, s.source_photo ? "animate_photo" : "video_ad", {
      objective: s.visual_objective, aspect_ratio: aspect, duration_seconds: seconds, resolution: "", variations: 1, output: "video", scenes: [],
      prompt: [s.prompt, s.camera && `Camera: ${s.camera}.`, s.motion && `Motion: ${s.motion}`].filter(Boolean).join("\n").slice(0, 2500),
      negative: s.negative, reference_asset_paths: s.source_photo ? [s.source_photo] : [],
    });
  });
  return { lines, problems };
}

export const totalOf = (lines: Pick<MotionLine, "estimate">[]) => Math.round(lines.reduce((s, l) => s + l.estimate, 0) * 1e6) / 1e6;
