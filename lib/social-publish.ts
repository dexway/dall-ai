// Publishes a finished post to a Facebook Page or Instagram professional account via the Graph API.
// Needs pages_manage_posts (Facebook) and instagram_content_publish (Instagram) on the connection's token.

const graph = () => `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || "v26.0"}`;
export type Media = { url: string; kind: "image" | "video" };
export class PublishError extends Error { retryable: boolean; constructor(m: string, retryable: boolean) { super(m); this.retryable = retryable; } }

async function call(fetcher: typeof fetch, url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetcher(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; code?: number } };
  if (!res.ok || j.error) {
    const msg = j.error?.message ?? `HTTP ${res.status}`;
    throw new PublishError(/permission|scope|\(#10\)|\(#200\)/i.test(msg) ? `Missing posting permission: reconnect via Meta. (${msg})` : msg, res.status >= 500 || res.status === 429);
  }
  return j;
}

export async function publishFacebook(a: { pageId: string; token: string; caption: string; media: Media; fetcher?: typeof fetch }): Promise<string> {
  const f = a.fetcher ?? fetch;
  const r = a.media.kind === "video"
    ? await call(f, `${graph()}/${a.pageId}/videos`, { file_url: a.media.url, description: a.caption, access_token: a.token })
    : await call(f, `${graph()}/${a.pageId}/photos`, { url: a.media.url, caption: a.caption, access_token: a.token });
  return String(r.post_id ?? r.id);
}

/** Instagram is two steps: create a container, wait until it's processed, then publish it. */
export async function publishInstagram(a: { igUserId: string; token: string; caption: string; media: Media; fetcher?: typeof fetch; waitMs?: number; pollMs?: number }): Promise<string> {
  const f = a.fetcher ?? fetch;
  const body: Record<string, string> = a.media.kind === "video"
    ? { media_type: "REELS", video_url: a.media.url, caption: a.caption, access_token: a.token }
    : { image_url: a.media.url, caption: a.caption, access_token: a.token };
  const c = await call(f, `${graph()}/${a.igUserId}/media`, body);
  const id = String(c.id);
  const until = Date.now() + (a.waitMs ?? 40_000);
  for (;;) {
    const s = (await (await f(`${graph()}/${id}?fields=status_code&access_token=${encodeURIComponent(a.token)}`)).json().catch(() => ({}))) as { status_code?: string };
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new PublishError("Instagram couldn't process the media.", false);
    if (Date.now() > until) throw new PublishError("Instagram is still processing the video; will retry.", true);
    await new Promise((r) => setTimeout(r, a.pollMs ?? 3000));
  }
  const p = await call(f, `${graph()}/${a.igUserId}/media_publish`, { creation_id: id, access_token: a.token });
  return String(p.id);
}

/** Caption = written caption + CTA, trimmed to Instagram's 2,200-character limit. */
export function buildCaption(idea: { caption?: string; hook?: string; cta?: string }): string {
  const parts = [idea.caption || idea.hook || "", idea.cta || ""].map((s) => s.trim()).filter(Boolean);
  return [...new Set(parts)].join("\n\n").slice(0, 2200);
}

/** When an item goes out: its planned date at the owner's hour, Lagos time (UTC+1, no DST). */
export function publishTime(plannedDate: string, hourLagos: number): Date {
  return new Date(`${plannedDate}T${String(hourLagos).padStart(2, "0")}:00:00+01:00`);
}
