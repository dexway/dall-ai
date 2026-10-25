"use client";
import { useEffect, useRef, useState } from "react";

type Props = {
  agent: { name: string; role: string; color: string; avatar: string | null; languages: string[] };
  business: string; slug: string; images: string[];
};
type Copy = { instagram: string; whatsapp_status: string; clip_script: string };

const W = 1080, H = 1350;
const INK = "#14231F", PAPER = "#F4F0E7", CORAL = "#D77A5C", FOREST = "#21352F";
const SLIDES = 6;

function loadImg(src: string | null): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((ok) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number) {
  const words = text.split(" "); let line = ""; let yy = y;
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, yy); line = w; yy += lh; } else line = t;
  }
  ctx.fillText(line, x, yy);
  return yy;
}

function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, r = 36) {
  const s = Math.max(w / img.width, h / img.height);
  ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip();
  ctx.drawImage(img, x + (w - img.width * s) / 2, y + (h - img.height * s) / 2, img.width * s, img.height * s);
  ctx.restore();
}

// A pill with the link, used on CTA slides.
function linkPill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, bg: string, fg: string) {
  ctx.font = "500 34px 'IBM Plex Mono', monospace";
  const w = ctx.measureText(text).width + 64;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x, y, Math.min(w, W - 160), 84, 42); ctx.fill();
  ctx.fillStyle = fg; ctx.fillText(text, x + 32, y + 26);
}

async function draw(canvas: HTMLCanvasElement, n: number, p: Props, link: string) {
  const ctx = canvas.getContext("2d")!;
  await document.fonts?.ready;
  const D = "800 96px 'Bricolage Grotesque', system-ui, sans-serif";
  const M = "500 30px 'IBM Plex Mono', ui-monospace, monospace";
  const B = "500 40px 'DM Sans', system-ui, sans-serif";
  const linkText = link.replace(/^https?:\/\//, "");
  const [avatar, photo] = await Promise.all([loadImg(p.agent.avatar), loadImg(p.images[(n - 1) % Math.max(1, p.images.length)] ?? null)]);
  const accent = p.agent.color;
  const bg = [accent, CORAL, PAPER, FOREST, INK, accent][n - 1];
  const fg = (n === 4 || n === 5) ? PAPER : INK;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = fg; ctx.textBaseline = "top";
  ctx.font = M; ctx.fillText(p.business.toUpperCase(), 80, 80);
  ctx.textAlign = "right"; ctx.fillText(`${n}/${SLIDES}`, W - 80, 80); ctx.textAlign = "left";

  if (n === 1) {
    if (avatar) { ctx.save(); ctx.beginPath(); ctx.arc(W / 2, 470, 230, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(avatar, W / 2 - 230, 240, 460, 460); ctx.restore(); }
    else { ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(W / 2, 470, 230, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = accent; ctx.font = "800 260px 'Bricolage Grotesque', sans-serif"; ctx.textAlign = "center"; ctx.fillText(p.agent.name[0], W / 2, 330); ctx.textAlign = "left"; }
    ctx.fillStyle = INK; ctx.font = D; wrap(ctx, `Meet ${p.agent.name}.`, 80, 800, W - 160, 104);
    ctx.font = B; wrap(ctx, `Our new ${p.agent.role.toLowerCase()}. Here to help you, day and night.`, 80, 930, W - 160, 54);
    ctx.font = M; ctx.fillText("SWIPE →", 80, H - 110);
  }
  if (n === 2) {
    if (photo) cover(ctx, photo, 80, 170, W - 160, 640);
    ctx.fillStyle = INK; ctx.font = "800 220px 'Bricolage Grotesque', sans-serif"; ctx.fillText("24/7", 80, photo ? 860 : 300);
    ctx.font = B; wrap(ctx, `Ask questions, check prices and place your order with ${p.agent.name} any time.`, 80, photo ? 1100 : 560, W - 160, 54);
  }
  if (n === 3) {
    ctx.fillStyle = INK; ctx.font = D; wrap(ctx, "How it works", 80, 190, W - 160, 104);
    ctx.font = B;
    const steps = [`Send "Hi" or tap the link.`, `Tell ${p.agent.name} what you need.`, "Get your total and pay by transfer.", "We confirm and get moving."];
    steps.forEach((s, i) => { ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(120, 420 + i * 180, 40, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = INK; ctx.font = "800 40px 'Bricolage Grotesque', sans-serif"; ctx.textAlign = "center"; ctx.fillText(String(i + 1), 120, 398 + i * 180); ctx.textAlign = "left"; ctx.font = B; wrap(ctx, s, 200, 396 + i * 180, W - 300, 52); });
    ctx.fillStyle = INK; ctx.font = M; ctx.fillText("👇 " + linkText, 80, H - 120);
  }
  if (n === 4) {
    if (photo) { cover(ctx, photo, 0, 0, W, H, 0); ctx.fillStyle = "rgba(20,35,31,.62)"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = PAPER; ctx.font = M; ctx.fillText(p.business.toUpperCase(), 80, 80); ctx.textAlign = "right"; ctx.fillText(`${n}/${SLIDES}`, W - 80, 80); ctx.textAlign = "left"; }
    ctx.fillStyle = PAPER; ctx.font = D; wrap(ctx, `${p.agent.name} speaks your language.`, 80, 620, W - 160, 104);
    ctx.font = B; ctx.fillStyle = accent; wrap(ctx, p.agent.languages.join(" · "), 80, 980, W - 160, 54);
  }
  if (n === 5) {
    // Strong CTA slide with the link.
    ctx.fillStyle = accent; ctx.font = "800 70px 'Bricolage Grotesque', sans-serif"; ctx.fillText("💬", 80, 300);
    ctx.fillStyle = PAPER; ctx.font = D; wrap(ctx, "Chat with us now.", 80, 420, W - 160, 104);
    ctx.font = B; wrap(ctx, `Real prices, fast replies, pay by transfer. ${p.agent.name} is online.`, 80, 640, W - 160, 54);
    ctx.fillStyle = accent; ctx.font = "800 48px 'Bricolage Grotesque', sans-serif"; ctx.fillText("Tap the link below 👇", 80, 980);
    linkPill(ctx, linkText, 80, 1080, accent, INK);
  }
  if (n === 6) {
    ctx.fillStyle = INK; ctx.font = D; wrap(ctx, "Why us?", 80, 190, W - 160, 104);
    ctx.font = "700 48px 'Bricolage Grotesque', sans-serif";
    const vals = ["⚡ Fast replies, 24/7", "💸 Real prices, no stories", "✅ Pay by transfer, confirmed fast", "🗣️ We speak your language"];
    vals.forEach((v, i) => { ctx.fillStyle = INK; wrap(ctx, v, 80, 420 + i * 150, W - 160, 56); });
    ctx.fillStyle = INK; ctx.font = M; ctx.fillText("👇 " + linkText, 80, H - 120);
  }
}

export default function LaunchKit(p: Props) {
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);
  const [copy, setCopy] = useState<Copy | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState("");

  // Default the link to the full chat URL once we're in the browser.
  useEffect(() => { if (!link) setLink(`${window.location.origin}/chat/${p.slug}`); /* eslint-disable-next-line */ }, [p.slug]);

  const key = JSON.stringify(p) + link;
  useEffect(() => { if (link) refs.current.forEach((c, i) => c && draw(c, i + 1, p, link)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [key]);

  function download(i: number) {
    const c = refs.current[i]; if (!c) return;
    try {
      const a = document.createElement("a");
      a.href = c.toDataURL("image/png"); a.download = `${p.slug}-launch-${i + 1}.png`; a.click();
    } catch { setErr("A photo blocked the download. Re-upload it from this device and try again."); }
  }

  async function writeCopy() {
    setBusy(true); setErr(null);
    const res = await fetch("/api/launch-kit", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(body.error ?? "Couldn't write captions.");
    setCopy(body);
  }

  return (
    <section className="panel" aria-labelledby="kit-h">
      <h2 id="kit-h">Launch kit</h2>
      <p style={{ color: "var(--ink-70)", fontSize: 14 }}>Ready-to-post slides announcing {p.agent.name}, built from your identity, colour and photos. The CTA slides show the link below — set it to your chat, WhatsApp or website so people can tap through.</p>

      <label className="field" style={{ maxWidth: 520 }}><span>Link on your CTA slides</span>
        <input className="input" type="text" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://your-link" />
        <small>Defaults to your chat page. Paste a wa.me link, your website, or an &ldquo;in bio&rdquo; link instead.</small>
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 200px))", gap: 12, marginTop: 12 }}>
        {Array.from({ length: SLIDES }, (_, i) => (
          <div key={i} style={{ display: "grid", gap: 6 }}>
            <canvas ref={(el) => { refs.current[i] = el; }} width={W} height={H} style={{ width: "100%", height: "auto", borderRadius: 10, border: "1px solid var(--ink-12, #e5e5e5)" }} aria-label={`Slide ${i + 1}`} />
            <button type="button" className="btn btn-line btn-sm" onClick={() => download(i)}>Save {i + 1}</button>
          </div>
        ))}
      </div>

      <div className="row-actions" style={{ marginTop: 12 }}><button type="button" className="btn btn-ink" onClick={writeCopy} disabled={busy}>{busy ? "Writing…" : "Write captions & clip script"}</button><small style={{ color: "var(--ink-50)" }}>Uses about 1–2 credits.</small></div>
      {err && <div className="notice notice-bad" role="alert">{err}</div>}
      {copy && (
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {([["Instagram caption", copy.instagram], ["WhatsApp status", copy.whatsapp_status], ["15-second clip script", copy.clip_script]] as const).map(([t, v]) => (
            <label key={t} className="field"><span>{t}</span><textarea className="input" readOnly value={v} rows={t.startsWith("15") ? 6 : 4} id={`copy-${t}`} /></label>
          ))}
        </div>
      )}
    </section>
  );
}
