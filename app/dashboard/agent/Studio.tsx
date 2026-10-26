"use client";
import { useEffect, useRef, useState } from "react";

type Preset = { key: string; label: string; emoji: string; persona: string; greeting: string; instructions: string; role?: string; blurb?: string };
type Agent = {
  id: string; name: string; role_title: string; persona: string; greeting: string;
  instructions: string; website_url: string | null; knowledge: string;
  accent_color: string; max_discount_pct: number; languages: string[]; voice_style: string;
};

const LANGS = ["English", "Pidgin", "Yorùbá", "Igbo", "Hausa"];
const VOICES = [
  { id: "lagos-english", label: "Lagos English" }, { id: "pidgin", label: "Pidgin" },
  { id: "yoruba", label: "Yorùbá" }, { id: "igbo", label: "Igbo" }, { id: "hausa", label: "Hausa" },
];

export default function Studio({ agent, avatarUrl, builtinPresets, customPresets, initialPreset, save, learnFromWebsite, saveAsPreset, addKnowledgeFiles, clearKnowledge }: {
  agent: Agent; avatarUrl: string | null;
  builtinPresets: Preset[]; customPresets: Preset[]; initialPreset?: string;
  save: (f: FormData) => void; learnFromWebsite: (f: FormData) => void; saveAsPreset: (f: FormData) => void;
  addKnowledgeFiles: (f: FormData) => void; clearKnowledge: () => void;
}) {
  const [name, setName] = useState(agent.name);
  const [role, setRole] = useState(agent.role_title);
  const [persona, setPersona] = useState(agent.persona);
  const [greeting, setGreeting] = useState(agent.greeting);
  const [instructions, setInstructions] = useState(agent.instructions);
  const [website, setWebsite] = useState(agent.website_url ?? "");
  const [color, setColor] = useState(agent.accent_color);
  const [discount, setDiscount] = useState(String(agent.max_discount_pct));
  const [langs, setLangs] = useState<string[]>(agent.languages);
  const [voice, setVoice] = useState(agent.voice_style);
  const [applied, setApplied] = useState<string>("");

  const apply = (p: Preset) => { setPersona(p.persona); setGreeting(p.greeting); setInstructions(p.instructions); if (p.role) setRole(p.role); setApplied(p.label); };
  const top = useRef<HTMLElement>(null);
  // Opened from a "ready-made assistant" link: load that preset and bring the studio into view.
  useEffect(() => {
    const p = builtinPresets.find((x) => x.key === initialPreset);
    if (p) { apply(p); top.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPreset]);
  const blanks = (instructions.match(/\[[^\]]+\]/g) ?? []).length;
  const toggleLang = (l: string) => setLangs((xs) => xs.includes(l) ? xs.filter((x) => x !== l) : [...xs, l]);

  return (
    <>
      <section className="panel" ref={top} id="presets">
        <h2>Start from a ready-made assistant</h2>
        <p style={{ color: "var(--ink-70)", fontSize: 14, marginTop: 2 }}>Each one is a complete, tested setup for that kind of business. Pick one, fill the few <b>[blanks]</b> with your details (delivery, hours, policies), and save. Edit anything else you like, then save it as your own preset.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10, marginTop: 10 }}>
          {[...builtinPresets, ...customPresets].map((p) => (
            <button type="button" key={p.key} onClick={() => apply(p)}
              style={{ textAlign: "left", border: applied === p.label ? "2px solid var(--lime, #C8EE72)" : "1px solid var(--line, #e5e5e5)", borderRadius: 10, padding: "10px 12px", background: "#fff", cursor: "pointer" }}>
              <div style={{ fontSize: 20 }}>{p.emoji}</div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{p.label}</div>
              {p.blurb && <div style={{ fontSize: 12, color: "var(--ink-70)", marginTop: 3, lineHeight: 1.4 }}>{p.blurb}</div>}
            </button>
          ))}
        </div>
        {applied && <p style={{ fontSize: 13, marginTop: 10, padding: "8px 10px", borderRadius: 8, background: blanks ? "#FBF0DC" : "#E3F5EA", color: blanks ? "#8A5A0B" : "#1E7A45" }}>Loaded <b>{applied}</b>. {blanks ? <>Fill the <b>{blanks} [bracketed] blank{blanks > 1 ? "s" : ""}</b> in Instructions with your details (anything you leave, your assistant will say the team will confirm),</> : <>All set,</>} then click <b>Save assistant</b>.</p>}
      </section>

      <div className="two" style={{ marginTop: 16 }}>
        <div style={{ display: "grid", gap: 16 }}>
          <form action={save} className="panel">
            <input type="hidden" name="id" value={agent.id} />
            <h2>Identity</h2>
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              {avatarUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={avatarUrl} alt="" className="thumb" style={{ width: 64, height: 64, borderRadius: "50%" }} />
                : <span className="thumb" style={{ width: 64, height: 64, borderRadius: "50%", display: "grid", placeItems: "center", background: color, fontWeight: 800, fontSize: 24 }}>{name[0] ?? "A"}</span>}
              <label className="field" style={{ flex: 1 }}><span>Face / avatar</span><input type="file" name="avatar" accept="image/png,image/jpeg,image/webp" className="input" /></label>
            </div>
            <div className="form-grid">
              <label className="field"><span>Name</span><input name="name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required /></label>
              <label className="field"><span>Job title</span><input name="role_title" className="input" value={role} onChange={(e) => setRole(e.target.value)} maxLength={60} /></label>
            </div>
            <label className="field"><span>Personality</span><textarea name="persona" className="input" value={persona} onChange={(e) => setPersona(e.target.value)} maxLength={600} rows={2} /><small>How it talks.</small></label>
            <label className="field"><span>First greeting</span><input name="greeting" className="input" value={greeting} onChange={(e) => setGreeting(e.target.value)} maxLength={300} /></label>

            <h2 style={{ marginTop: 18 }}>Knowledge &amp; behaviour</h2>
            <label className="field"><span>What your assistant should know and how it should work</span>
              <textarea name="instructions" className="input" value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={4000} rows={7} placeholder="Opening hours, delivery areas and times, return policy, common questions and answers, what to always ask, what never to promise…" />
              <small>This is your assistant&rsquo;s brain. The more you put here, the better it answers. It never invents prices — those come from your catalogue.</small>
            </label>

            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}><span>Replies in</span>
              <div className="row-actions">{LANGS.map((l) => (
                <label key={l} className="chip" style={{ cursor: "pointer" }}><input type="checkbox" checked={langs.includes(l)} onChange={() => toggleLang(l)} /> {l}</label>
              ))}</div>
              {langs.map((l) => <input key={l} type="hidden" name={`lang_${l}`} value="1" />)}
              <small>English and Pidgin read naturally. Have a native speaker check the others before launch.</small>
            </fieldset>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}><span>Voice for calls &amp; voice notes</span>
              <div className="row-actions">{VOICES.map((v) => (
                <label key={v.id} className="chip" style={{ cursor: "pointer" }}><input type="radio" name="voice_style" value={v.id} checked={voice === v.id} onChange={() => setVoice(v.id)} /> {v.label}</label>
              ))}</div>
            </fieldset>
            <div className="form-grid">
              <label className="field"><span>Brand colour</span><input type="color" name="accent_color" value={color} onChange={(e) => setColor(e.target.value)} className="input" style={{ padding: 4 }} /></label>
              <label className="field"><span>Max discount it may give (%)</span><input type="number" name="max_discount_pct" min={0} max={50} step={1} value={discount} onChange={(e) => setDiscount(e.target.value)} className="input" /><small>Above this, it passes the request to you.</small></label>
            </div>
            <input type="hidden" name="website_url" value={website} />
            <label className="field"><span>Your photos for the launch kit (up to 6)</span><input type="file" name="images" accept="image/png,image/jpeg,image/webp" multiple className="input" /></label>
            <button className="btn btn-ink">Save assistant</button>
          </form>
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          <section className="panel">
            <h2>Teach it from your website</h2>
            <p style={{ color: "var(--ink-70)", fontSize: 14 }}>Paste your website link and Dall AI reads it to learn about your business. You can edit what it learns in the Knowledge box.</p>
            <form action={learnFromWebsite} style={{ display: "grid", gap: 8 }}>
              <input name="website_url" className="input" type="url" placeholder="https://yourbusiness.com" value={website} onChange={(e) => setWebsite(e.target.value)} />
              <button className="btn btn-lime btn-sm" disabled={!website}>Learn from my website</button>
            </form>
          </section>

          <section className="panel">
            <h2>Upload price lists &amp; documents</h2>
            <p style={{ color: "var(--ink-70)", fontSize: 14 }}>Add PDFs, Word (.docx), text or CSV files — menus, price lists, policies, FAQs. Dall AI reads them into your assistant&rsquo;s memory.</p>
            <form action={addKnowledgeFiles} style={{ display: "grid", gap: 8 }}>
              <input name="docs" type="file" multiple accept=".pdf,.docx,.txt,.csv,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/csv" className="input" required />
              <button className="btn btn-lime btn-sm">Add to memory</button>
              <small style={{ color: "var(--ink-70)" }}>Up to 5 files, 10 MB each. Scanned images can&rsquo;t be read — type those details into the Knowledge box.</small>
            </form>
          </section>

          {agent.knowledge && <section className="panel">
            <h2>What it has learned</h2>
            <div style={{ fontSize: 13, color: "var(--ink-70)", maxHeight: 220, overflow: "auto", border: "1px solid var(--line,#e5e5e5)", borderRadius: 8, padding: 10, whiteSpace: "pre-wrap" }}>{agent.knowledge.slice(0, 3000)}{agent.knowledge.length > 3000 ? "…" : ""}</div>
            <p style={{ fontSize: 12, color: "var(--ink-70)", marginTop: 6 }}>{agent.knowledge.length.toLocaleString()} characters from your website and documents. Prices still come only from your Catalogue.</p>
            <form action={clearKnowledge}><button className="btn btn-ghost btn-sm" style={{ color: "var(--bad, #b00)" }}>Clear learned knowledge</button></form>
          </section>}

          <section className="panel">
            <h2>Save as a preset</h2>
            <p style={{ color: "var(--ink-70)", fontSize: 14 }}>Save this personality, greeting and instructions as your own preset to reuse later.</p>
            <form action={saveAsPreset} style={{ display: "grid", gap: 8 }}>
              <input name="preset_name" className="input" placeholder="e.g. My boutique setup" maxLength={40} required />
              <input type="hidden" name="persona" value={persona} />
              <input type="hidden" name="greeting" value={greeting} />
              <input type="hidden" name="instructions" value={instructions} />
              <button className="btn btn-line btn-sm">Save preset</button>
            </form>
          </section>
        </div>
      </div>
    </>
  );
}
