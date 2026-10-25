"use client";
import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant" | "err"; text: string };
type Pending = { reference: string; total_kobo: number; expires_at: string | null; status: string } | null;
type Props = { slug: string; business: string; agent: { name: string; role: string; greeting: string; avatar: string | null; color: string } };

const naira = (k: number) => "₦" + (k / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 });

function linkify(text: string) {
  return text.split(/(https?:\/\/[^\s)]+)/g).map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noopener noreferrer">{p.includes("/pay/") ? "Open checkout →" : p}</a> : p));
}

function useCountdown(until: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!until) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [until]);
  if (!until) return null;
  const ms = new Date(until).getTime() - now;
  if (ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export default function ChatBox({ slug, business, agent }: Props) {
  const key = `dall-chat-${slug}`;
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", text: agent.greeting }]);
  const [ids, setIds] = useState<{ conversationId?: string; visitorToken?: string }>({});
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const left = useCountdown(pending?.status === "awaiting_payment" || pending?.status === "payment_rejected" ? pending.expires_at : null);
  const expired = left === "0:00";

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(key) ?? "null");
      if (s?.ids) {
        setIds(s.ids); setMsgs(s.msgs);
        fetch(`/api/agent/${slug}/chat?c=${s.ids.conversationId}&v=${s.ids.visitorToken}`).then((r) => r.json()).then((b) => setPending(b.pending ?? null)).catch(() => {});
      }
    } catch { /* fresh chat */ }
  }, [key, slug]);
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify({ ids, msgs: msgs.slice(-40) })); } catch { /* storage off */ }
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [msgs, ids, key]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    setText(""); setBusy(true);
    setMsgs((m) => [...m, { role: "user", text: message }]);
    try {
      const res = await fetch(`/api/agent/${slug}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, ...ids }) });
      const body = await res.json();
      if (body.conversationId) setIds({ conversationId: body.conversationId, visitorToken: body.visitorToken });
      if ("pending" in body) setPending(body.pending);
      setMsgs((m) => [...m, res.ok ? { role: "assistant", text: body.reply } : { role: "err", text: body.error ?? "Something went wrong." }]);
    } catch {
      setMsgs((m) => [...m, { role: "err", text: "No connection. Check your data and try again." }]);
    } finally { setBusy(false); }
  }

  async function upload(file: File) {
    if (!ids.conversationId) return;
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", text: `📎 ${file.name}` }]);
    const fd = new FormData();
    fd.append("receipt", file); fd.append("conversationId", ids.conversationId); fd.append("visitorToken", ids.visitorToken ?? "");
    try {
      const res = await fetch(`/api/agent/${slug}/receipt`, { method: "POST", body: fd });
      const body = await res.json();
      if ("pending" in body) setPending(body.pending);
      setMsgs((m) => [...m, res.ok ? { role: "assistant", text: body.reply } : { role: "err", text: body.error ?? "Upload failed." }]);
    } catch {
      setMsgs((m) => [...m, { role: "err", text: "Upload failed. Check your data and try again." }]);
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  const canUpload = Boolean(ids.conversationId && pending && ["awaiting_payment", "payment_rejected"].includes(pending.status));

  return (
    <>
      <div className="chat-head glass">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {agent.avatar ? <img className="av" src={agent.avatar} alt="" /> : <span className="av" style={{ background: agent.color }}>{agent.name[0]}</span>}
        <div><b>{agent.name}</b><small>{agent.role} · {business}</small></div>
      </div>

      {pending && (
        <div className={`pay-bar ${pending.status === "payment_confirmed" ? "ok" : expired ? "late" : ""}`} role="status">
          {pending.status === "payment_confirmed" ? <span>✓ Payment confirmed for <b className="mono">{pending.reference}</b></span>
            : pending.status === "verification_pending" ? <span>Receipt received · {business} is verifying <b className="mono">{pending.reference}</b></span>
            : <>
                <span>Pay <b className="mono">{naira(pending.total_kobo)}</b> · ref <b className="mono">{pending.reference}</b></span>
                <span className="timer mono">{expired ? "Time's up" : `⏱ ${left}`}</span>
                <button type="button" className="btn btn-lime btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}>📎 Send receipt</button>
              </>}
        </div>
      )}

      <div className="chat-log" ref={log} aria-live="polite">
        {msgs.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.role === "assistant" ? linkify(m.text) : m.text}</div>)}
        {busy && <div className="typing">{agent.name} is typing…</div>}
      </div>
      <form className="composer glass" onSubmit={send}>
        <input ref={fileRef} id="chat-receipt" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
        <button type="button" className="attach" aria-label="Send transfer receipt" title={canUpload ? "Send transfer receipt" : "Order first, then send your receipt"}
          onClick={() => fileRef.current?.click()} disabled={!canUpload || busy}>📎</button>
        <label htmlFor="chat-input" style={{ position: "absolute", left: -9999 }}>Message</label>
        <input id="chat-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${agent.name}…`} maxLength={2000} autoComplete="off" />
        <button className="btn btn-lime btn-sm" disabled={busy || !text.trim()}>Send</button>
      </form>
    </>
  );
}
