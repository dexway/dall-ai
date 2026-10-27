import Link from "next/link";
import { BRAND } from "@/lib/config";
import { PARTNERS, PARTNERS_HEADING } from "@/lib/partners";
import "./landing.css";

const USES = [
  { who: "Food vendors", title: "Order taking", text: "Takes party tray and daily orders, sends the total and payment link, confirms when the money lands." },
  { who: "Salons & clinics", title: "Booking agent", text: "Checks open slots, books the appointment, sends reminders the day before." },
  { who: "Real estate", title: "Lead qualification", text: "Asks budget, area and move-in date, then books inspections only for serious buyers." },
  { who: "Events", title: "Ticketing agent", text: "Sells tables and tickets, collects payment and sends the ticket in the same chat." },
  { who: "Logistics", title: "Delivery updates", text: "Answers \"where my package?\" from your tracking system, all day, without a call centre." },
  { who: "Schools & trainers", title: "Class enrolment", text: "Explains the course, takes payment, registers the student and shares the materials." },
  { who: "Any business", title: "Customer survey", text: "Runs short surveys after delivery and gives you the answers as a clean list." },
  { who: "Retail", title: "Support desk", text: "Handles returns, prices and opening hours, and hands hard cases to your team with full context." },
];

const NODES = [
  { k: "Trigger", t: "New WhatsApp message", d: "Or an Instagram DM, a Messenger chat, a tap on your ad." },
  { k: "Send message", t: "Greeting + menu", d: "Buttons and lists on WhatsApp, quick replies on Messenger." },
  { k: "Condition", t: "Order or question?", d: "Branch on what the customer said or picked." },
  { k: "LLM agent", t: "Amaka handles it", d: "Answers, recommends, quotes from your real catalogue.", llm: true },
  { k: "API call", t: "Check stock / tracking", d: "Reach your inventory, CRM or delivery system." },
  { k: "Thread submit", t: "Save the order", d: "Customer, items, total and reference saved to your dashboard." },
];

export default function Landing() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="wrap">
          <Link href="/" className="logo" aria-label={`${BRAND.name} home`}><span className="logo-mark" aria-hidden>d</span>{BRAND.name}</Link>
          <nav className="lp-links" aria-label="Main">
            <a href="#channels">Channels</a><a href="#sell">Sell & verify</a><a href="#uses">Use cases</a><a href="#studio">Identity studio</a><a href="#pricing">Pricing</a>
          </nav>
          <div className="lp-nav-cta">
            <Link href="/login" className="login">Log in</Link>
            <Link href="/signup" className="btn btn-lime btn-sm">Start free →</Link>
          </div>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="wrap hero-grid">
            <div>
              <span className="tag">● Built in Lagos for Nigerian businesses</span>
              <h1>The AI staff that answers, sells <em>and checks the money.</em></h1>
              <p className="hero-sub">
                Give your business an assistant with its own name and face. It replies on WhatsApp, Instagram, Messenger and your website (calls, SMS and USSD are coming soon),
                quotes from your real prices, sends your bank details with a payment timer, and flags fake transfer receipts before you ship.
              </p>
              <div className="hero-ctas">
                <Link href="/signup" className="btn btn-lime">Build your assistant free</Link>
                <a href="#sell" className="btn btn-ghost">See how payments work</a>
              </div>
              <div className="langs" aria-label="Languages">
                <span>English</span><span>Pidgin</span><span>Yorùbá</span><span>Igbo</span><span>Hausa</span>
              </div>
            </div>

            <div className="hero-visual">
            <div className="hero-photo" role="img" aria-label="The owner of Mama Put Kitchen holds up her phone, pleased, as her assistant takes a catering order on WhatsApp while her staff cook">
              <span className="photo-tag">● Mama Put Kitchen · Amaka just sold ₦140,000 of jollof trays</span>
            </div>
            <div className="scene" aria-label="Example conversation between a customer and an assistant">
              <div className="scene-head">
                <span className="agent-pill glass"><span className="avatar">A</span>Amaka · Mama Put Kitchen</span>
                <span className="live">LIVE ON WHATSAPP</span>
              </div>
              <div className="chat-loop">
                <div className="msg-row m1"><div className="bubble me glass"><span className="avatar" style={{ background: "var(--coral)" }}>T</span>
                  <span><span className="who">Tunde · 07:42</span>Abeg, I need jollof for 40 people this Saturday. Wetin be the price?</span></div></div>
                <div className="msg-row t1" aria-hidden><div className="typing-dots glass"><i /><i /><i /></div></div>
                <div className="msg-row m2"><div className="bubble ai glass">
                  <span className="who">Amaka · AI assistant</span>
                  Good morning Tunde! For 40 guests, these two fit well:
                  <div className="cards">
                    <div className="pcard"><div className="swatch" /><b>Party jollof cooler</b><span className="mono">₦85,000</span><br />serves 40</div>
                    <div className="pcard"><div className="swatch" /><b>Jollof + chicken trays</b><span className="mono">₦140,000</span><br />4 × 10 trays</div>
                  </div>
                </div></div>
                <div className="msg-row m3"><div className="bubble me glass"><span className="avatar" style={{ background: "var(--coral)" }}>T</span>
                  <span>The trays. I go pay transfer.</span></div></div>
                <div className="msg-row t2" aria-hidden><div className="typing-dots glass"><i /><i /><i /></div></div>
                <div className="msg-row m4"><div className="bubble ai glass">
                  <span className="who">Amaka · AI assistant</span>
                  Done ✓ Transfer <b className="mono">₦140,000</b> to GTBank <span className="mono">0123454417</span> · Mama Put Kitchen. Narration <span className="mono">MAM-7KQ2X9PD</span>. You have 60 mins, then send the screenshot here 📎
                </div></div>
                <div className="msg-row m5"><div className="receipt-row">
                  <span className="chip chip-glass">Receipt uploaded</span>
                  <span className="chip chip-lime">Amount matches · waiting for your OK</span>
                </div></div>
              </div>
              <div className="ask glass"><span>Ask Amaka anything…</span><span className="send" aria-hidden>↑</span></div>
            </div>
            </div>
          </div>
        </section>

        {PARTNERS.length > 0 && (
          <section className="partners" aria-labelledby="partners-h">
            <div className="wrap">
              <h2 id="partners-h">{PARTNERS_HEADING}</h2>
              <ul className="partner-row">
                {PARTNERS.map((p) => {
                  // eslint-disable-next-line @next/next/no-img-element
                  const img = <img src={p.logo} alt={p.name} width={p.width} height={p.height} loading="lazy" />;
                  return <li key={p.name}>{p.href ? <a href={p.href} target="_blank" rel="noopener noreferrer">{img}</a> : <span>{img}</span>}</li>;
                })}
              </ul>
            </div>
          </section>
        )}

        <section className="sec" id="channels">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">One assistant, every channel</span>
              <h2>Set it up once. <em>Your customers reach it however they like.</em></h2>
              <p>Smartphone, feature phone or a plain call: the same assistant, the same prices, the same order history in your dashboard.</p>
            </div>
            <div className="bento">
              <article className="tile glass t-wa">
                <h3>WhatsApp, Instagram &amp; Messenger</h3>
                <p>Buttons, product lists, voice notes and receipts, on your business number.</p>
                <div className="sms"><div>Do you deliver to Lekki Phase 1?</div><div>Yes! ₦2,500 delivery, same day if you order before 2pm.</div></div>
              </article>
              <article className="tile glass t-call">
                <h3>Calls in and out <span className="soon">Coming soon</span></h3>
                <p>Picks up when you can't, and calls customers back to confirm orders and remind them about bookings.</p>
                <div className="call-row"><span>↙ Inbound</span><span>↗ Outbound reminders</span><span>Nigerian voices</span></div>
                <div className="wave" aria-hidden>{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ height: `${20 + ((i * 37) % 80)}%`, animationDelay: `${(i % 7) * 0.12}s` }} />)}</div>
              </article>
              <article className="tile glass t-ussd">
                <h3>USSD <span className="soon">Coming soon</span></h3>
                <p>For customers without data.</p>
                <div className="ussd">Dial <b>*347*88#</b><br />1. Place order<br />2. Track order<br />3. Talk to Amaka</div>
              </article>
              <article className="tile glass t-sms">
                <h3>Two-way SMS <span className="soon">Coming soon</span></h3>
                <p>Confirmations and replies by text.</p>
                <div className="sms"><div>MAM-7KQ2 paid ✓</div><div>Thank you! Delivery 4pm.</div></div>
              </article>
              <article className="tile glass t-web">
                <h3>Website widget</h3>
                <p>One line of code on your site, or share your chat link.</p>
                <span className="widget">💬 Chat with Amaka</span>
              </article>
            </div>
          </div>
        </section>

        <section className="sec paper-band" id="sell">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">Sell & verify</span>
              <h2>From “how much?” to <em>paid and confirmed.</em></h2>
              <p>Your assistant only quotes from your catalogue and your approved offers. Totals are calculated on our server, never guessed, and an order is only marked paid when the money is verified.</p>
            </div>
            <div className="flow">
              <div className="step"><b>Discover</b><p>Asks what they need, budget and date.</p></div>
              <div className="step"><b>Recommend</b><p>Basic, standard or premium from your real items.</p></div>
              <div className="step"><b>Quote</b><p>Itemised naira total with any approved discount.</p></div>
              <div className="step"><b>Bank details</b><p>Sent in the chat with the exact amount, reference and a countdown.</p></div>
              <div className="step"><b>Receipt</b><p>Customer taps 📎 and sends the transfer screenshot in the chat.</p></div>
              <div className="step hot"><b>Verify</b><p>Read and compared automatically, approved by you, confirmed in chat.</p></div>
            </div>
            <div className="verify">
              <div className="receipt" aria-label="Example receipt check">
                <span className="eyebrow" style={{ color: "var(--ink)" }}>Receipt check · MAM-7KQ2X9PD</span>
                <dl>
                  <dt>Amount</dt><dd>₦140,000 <span className="chip chip-ok">matches</span></dd>
                  <dt>To account</dt><dd>•••• 4417 <span className="chip chip-ok">yours</span></dd>
                  <dt>Name</dt><dd>MAMA PUT KITCHEN <span className="chip chip-ok">matches</span></dd>
                  <dt>Date</dt><dd>Sat 07:58 <span className="chip chip-ok">after order</span></dd>
                  <dt>Status text</dt><dd>“Successful” <span className="chip chip-warn">needs your OK</span></dd>
                </dl>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><span className="btn btn-ink btn-sm">Approve payment</span><span className="btn btn-line btn-sm">Reject with reason</span></div>
              </div>
              <div className="verify-copy">
                <h3>No more “I don send am” without the money.</h3>
                <ul>
                  <li>The assistant reads the screenshot and lines it up against the order: amount, your account, your name, the date.</li>
                  <li>Short payments, wrong accounts, failed transfers and old receipts are flagged in red.</li>
                  <li>A screenshot never marks an order paid on its own. You approve with one tap, and every decision is logged.</li>
                  <li>Money goes straight to your own account. Paystack card payments are optional.</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="sec">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">Flow builder</span>
              <h2>Six building blocks. <em>Any customer journey.</em></h2>
              <p>Start from a template, then change what happens at each step. No code needed.</p>
            </div>
            <div className="canvas">
              <div className="nodes">
                {NODES.map((n) => (
                  <div key={n.k} className={`node glass${n.llm ? " llm" : ""}`}><span className="k">{n.k}</span><b>{n.t}</b><p>{n.d}</p></div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="sec" id="uses" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">Use cases</span>
              <h2>Ready-made assistants for <em>how Lagos does business.</em></h2>
            </div>
            <div className="uses">
              {USES.map((u) => <article key={u.title} className="use glass"><span className="who">{u.who}</span><b>{u.title}</b><p>{u.text}</p></article>)}
            </div>
          </div>
        </section>

        <section className="sec" id="studio" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">Identity studio + launch kit</span>
              <h2>Give your assistant a name, a face and a voice. <em>Then announce it.</em></h2>
              <p>Choose how it sounds, upload your own photos, and get ready-to-post carousels, a WhatsApp status and a short clip script telling customers they can now order from Amaka any time.</p>
            </div>
            <div className="studio">
              <div className="id-card glass">
                <div className="id-top"><span className="avatar">A</span><div><b>Amaka</b><span>Sales & support · Mama Put Kitchen</span></div></div>
                <div className="id-rows">
                  <div><span>Personality</span><span>Warm, quick, a little playful</span></div>
                  <div><span>Answers in</span><span>English, Pidgin, Yorùbá</span></div>
                  <div><span>Discount limit</span><span className="mono">5%</span></div>
                </div>
                <div>
                  <p style={{ fontSize: 13, color: "var(--mint-45)", marginBottom: 8 }}>Voice for calls and voice notes</p>
                  <div className="voices"><span className="on">Lagos English</span><span>Pidgin</span><span>Yorùbá</span><span>Igbo</span><span>Hausa</span></div>
                </div>
              </div>
              <div>
                <div className="kit">
                  <div className="slide s1"><small>New at Mama Put</small><b>Meet Amaka, our new assistant.</b><small>Swipe →</small></div>
                  <div className="slide s2"><small>Order any time</small><span className="big">24/7</span><b>Trays, coolers, small chops.</b></div>
                  <div className="slide s3"><small>How it works</small><b>WhatsApp “Hi” to 0803 000 0000. Amaka does the rest.</b><small>mama-put · dall.ai</small></div>
                </div>
                <p className="kit-note">Generated from your assistant&apos;s identity and your brand colours. Download as images for Instagram, WhatsApp status and flyers.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="sec" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">Why {BRAND.name}</span>
              <h2>Built for businesses that <em>take money in chat.</em></h2>
            </div>
            <div className="compare glass">
              <table>
                <thead><tr><th>What you need</th><th>{BRAND.name}</th><th>Typical chatbot builder</th></tr></thead>
                <tbody>
                  <tr><td>WhatsApp, Instagram, Messenger, web chat</td><td>✓ Included</td><td>✓ Usually</td></tr>
                  <tr><td>Phone calls, SMS and USSD</td><td>Coming soon</td><td>Often extra or missing</td></tr>
                  <tr><td>Quotes from your real catalogue</td><td>✓ Prices computed on our server</td><td>Depends on your setup</td></tr>
                  <tr><td>Bank transfer in chat with a payment timer</td><td>✓ Built in</td><td>✗</td></tr>
                  <tr><td>Transfer receipt checking</td><td>✓ Read, compared, flagged</td><td>✗</td></tr>
                  <tr><td>Assistant name, face and voice</td><td>✓ Identity studio</td><td>Name only</td></tr>
                  <tr><td>Launch carousels and status posts</td><td>✓ Launch kit</td><td>✗</td></tr>
                  <tr><td>AI keys and model setup</td><td>✓ None needed</td><td>Sometimes bring your own</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="sec" id="pricing" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">Pricing in naira</span>
              <h2>Free during <em>early access.</em></h2>
              <p>No AI accounts or API keys to set up. Every live feature is free while we&apos;re in early access; paid plans in naira come later, and you&apos;ll hear about them before anything changes.</p>
            </div>
            <div className="plans">
              <div className="plan glass feat"><h3>Early access</h3><div className="price">₦0 <small>/ month</small></div>
                <ul><li>AI assistant on WhatsApp, Instagram, Messenger and web chat</li><li>Catalogue, checkout, bank transfer timer and receipt checks</li><li>Inbox, leads, promotions and click-to-chat ads</li><li>Fair-use daily limit per business</li></ul>
                <Link href="/signup" className="btn btn-lime">Create your free workspace</Link></div>
            </div>
            <p className="credit-note">Ads you run are paid to Meta from your own ad account. Paystack card payments use your own Paystack account and fees.</p>
          </div>
        </section>

        <section className="sec" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <div className="final">
              <span className="eyebrow" style={{ color: "var(--ink)" }}>Ready when you are</span>
              <h2>Your assistant can be taking orders tonight.</h2>
              <p>Add your products, name your assistant, connect your account. We&apos;ll give you a chat link to test before any customer sees it.</p>
              <div><Link href="/signup" className="btn btn-ink">Create your free workspace</Link></div>
            </div>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="wrap"><span>© {new Date().getFullYear()} {BRAND.name} · Lagos, Nigeria</span><span>{BRAND.supportEmail}</span></div>
      </footer>
    </div>
  );
}
