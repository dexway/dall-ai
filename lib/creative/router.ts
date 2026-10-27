// Content Creator model routing (pure). Each creative task maps to the models best at it, best first.
// The Creative Director never asks the owner to pick a model: it picks the highest-ranked ENABLED model
// tagged for the task, and falls back down the list. Admins enable models and set prices in /admin/creative.

export type Task =
  | "product_photo"   // clean product / food shot from the owner's photo
  | "lifestyle_photo" // realistic people / scene imagery
  | "poster"          // promo graphic with readable text (prices, offers)
  | "photo_edit"      // edit the owner's own photo (background, light, add props)
  | "animate_photo"   // turn a product photo into a short clip
  | "video_ad"        // text-to-video ad / reel
  | "cinematic";      // high-end mood / hero visuals

export const TASKS: Record<Task, { label: string; kind: "image" | "video"; needsReference: boolean; why: string }> = {
  product_photo: { label: "Product photo", kind: "image", needsReference: true, why: "Keeps your real product and makes it look shot in a studio." },
  lifestyle_photo: { label: "Lifestyle photo", kind: "image", needsReference: false, why: "Realistic people and places that feel local, not stock." },
  poster: { label: "Promo poster", kind: "image", needsReference: false, why: "Needs sharp, correctly spelled text for prices and offers." },
  photo_edit: { label: "Edit my photo", kind: "image", needsReference: true, why: "Changes background, light or props while keeping your product." },
  animate_photo: { label: "Animate a photo", kind: "video", needsReference: true, why: "Brings a still product shot to life for Reels and Status." },
  video_ad: { label: "Video ad / reel", kind: "video", needsReference: false, why: "Short vertical video with motion and sound." },
  cinematic: { label: "Cinematic hero", kind: "image", needsReference: false, why: "Dramatic, high-end visuals for launches." },
};

/** Recommended Higgsfield model paths per task, best first (Oct 2026 research). Admin must confirm path + price. */
export const RECOMMENDED: Record<Task, string[]> = {
  product_photo: ["marketing-studio/image", "openai/gpt-image-2/edit", "higgsfield-ai/soul/v2/standard"],
  lifestyle_photo: ["higgsfield-ai/soul/v2/standard", "openai/gpt-image-2"],
  poster: ["openai/gpt-image-2", "marketing-studio/image"],
  photo_edit: ["openai/gpt-image-2/edit", "marketing-studio/image"],
  animate_photo: ["kling-video/v4.0/image-to-video", "bytedance/seedance-2.0/image-to-video", "minimax/h3/image-to-video"],
  video_ad: ["bytedance/seedance-2.0/text-to-video", "kling-video/v4.0/text-to-video", "alibaba/wan-3.0-prime/text-to-video"],
  cinematic: ["higgsfield-ai/cinema-studio/v2.5", "higgsfield-ai/soul/cinematic"],
};

export type RoutableModel = { id: string; endpoint: string; kind: "image" | "video"; enabled: boolean; tasks?: string[] | null; quality_rank?: number | null; image_param?: string | null };

/** Which task an approved calendar item needs. Owner photos turn "make" into "edit/animate". */
export function taskFor(item: { format: string; hasReference: boolean; needsText?: boolean }): Task {
  const video = ["reel", "short_video", "long_video", "story", "live"].includes(item.format);
  if (video) return item.hasReference ? "animate_photo" : "video_ad";
  if (item.needsText || item.format === "promotion") return "poster";
  if (item.format === "product_campaign") return item.hasReference ? "product_photo" : "cinematic";
  return item.hasReference ? "product_photo" : "lifestyle_photo";
}

/** Best enabled model for the task; tag match first (by rank), then any enabled model of the right kind. */
export function chooseModel<M extends RoutableModel>(task: Task, models: M[]): { model: M; fallback: boolean } | null {
  const t = TASKS[task];
  const usable = models.filter((m) => m.enabled && m.kind === t.kind && (!t.needsReference || m.image_param));
  const rank = (m: M) => {
    const r = RECOMMENDED[task].indexOf(m.endpoint);
    return (r >= 0 ? r : 50) * 1000 + (m.quality_rank ?? 100);
  };
  const tagged = usable.filter((m) => (m.tasks ?? []).includes(task)).sort((a, b) => rank(a) - rank(b));
  if (tagged.length) return { model: tagged[0], fallback: false };
  const anyKind = models.filter((m) => m.enabled && m.kind === t.kind).sort((a, b) => rank(a) - rank(b));
  return anyKind.length ? { model: anyKind[0], fallback: true } : null;
}
