"use client";
import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant" | "err"; text: string };
type Props = { slug: string; business: string; agent: { name: string; role: string; greeting: string; avatar: string | null; color: string } };

function linkify(text: string) {
  return text.split(/(https?:\/\/[^\s)]+)/g).map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noopener noreferrer">{p.includes("/pay/") ? "Open checkout →" : p}</a> : p));
}

export default function ChatBox({ slug, business, agent }: Props) {
  const key = `dall-chat-${slug}`;
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", text: agent.greeting }]);
  const [ids, setIds] = useState<{ conversationId?: string; visitorToken?: string }>({});
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem(key) ?? "null"); if (s?.ids) { setIds(s.ids); setMsgs(s.msgs); } } catch { /* fresh chat */ }
  }, [key]);
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
      setMsgs((m) => [...m, res.ok ? { role: "assistant", text: body.reply } : { role: "err", text: body.error ?? "Something went wrong." }]);
    } catch {
      setMsgs((m) => [...m, { role: "err", text: "No connection. Check your data and try again." }]);
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="chat-head glass">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {agent.avatar ? <img className="av" src={agent.avatar} alt="" /> : <span className="av" style={{ background: agent.color }}>{agent.name[0]}</span>}
        <div><b>{agent.name}</b><small>{agent.role} · {business}</small></div>
      </div>
      <div className="chat-log" ref={log} aria-live="polite">
        {msgs.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.role === "assistant" ? linkify(m.text) : m.text}</div>)}
        {busy && <div className="typing">{agent.name} is typing…</div>}
      </div>
      <form className="composer glass" onSubmit={send}>
        <label htmlFor="chat-input" className="sr-only" style={{ position: "absolute", left: -9999 }}>Message</label>
        <input id="chat-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${agent.name}…`} maxLength={2000} autoComplete="off" />
        <button className="btn btn-lime btn-sm" disabled={busy || !text.trim()}>Send</button>
      </form>
    </>
  );
}
