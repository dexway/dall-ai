"use client";
import { useState } from "react";

type Account = { ad_account_id: string; name: string | null; currency: string | null };
type Page = { external_id: string; display_name: string | null };
type Item = { id: string; name: string; imageUrl: string | null };

const AUDIENCES: { value: string; label: string }[] = [
  { value: "everyone", label: "Everyone in Nigeria" },
  { value: "ng_18_34", label: "Nigeria · 18–34" },
  { value: "ng_25_45", label: "Nigeria · 25–45" },
  { value: "ng_women", label: "Nigeria · women 18–45" },
  { value: "ng_men", label: "Nigeria · men 18–45" },
];

const CTA: Record<string, string> = { whatsapp: "Send WhatsApp message", messenger: "Send message", instagram: "Send message" };

export default function AdBuilder({ accounts, pages, items, action }: {
  accounts: Account[]; pages: Page[]; items: Item[];
  action: (formData: FormData) => void;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.ad_account_id ?? "");
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const [destination, setDestination] = useState("whatsapp");
  const [budget, setBudget] = useState(2000);
  const [message, setMessage] = useState("Chat with us now to order — fast replies, pay by transfer.");

  const account = accounts.find((a) => a.ad_account_id === accountId) ?? accounts[0];
  const cur = account?.currency ?? "NGN";
  const item = items.find((i) => i.id === itemId) ?? items[0];
  const hasPage = pages.length > 0;

  const budgetHint = cur === "NGN"
    ? "₦2,000/day is a solid start. Meta needs about ₦1,500/day to deliver steadily."
    : `About 3–5 ${cur}/day is a solid start for a new campaign.`;

  return (
    <div style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0,1fr) 300px", alignItems: "start" }}>
      <form action={action} style={{ display: "grid", gap: 12 }}>
        {accounts.length > 1 && (
          <label>Ad account<br />
            <select name="ad_account_id" value={accountId} onChange={(e) => setAccountId(e.target.value)} style={{ width: "100%" }}>
              {accounts.map((a) => <option key={a.ad_account_id} value={a.ad_account_id}>{a.name ?? a.ad_account_id} ({a.currency ?? "?"})</option>)}
            </select>
          </label>
        )}
        {accounts.length === 1 && <input type="hidden" name="ad_account_id" value={accountId} />}

        {pages.length > 1 ? (
          <label>Facebook Page<br />
            <select name="page_id" required style={{ width: "100%" }}>
              {pages.map((p) => <option key={p.external_id} value={p.external_id}>{p.display_name ?? p.external_id}</option>)}
            </select>
          </label>
        ) : hasPage ? <input type="hidden" name="page_id" value={pages[0].external_id} />
          : <div className="notice notice-bad" role="alert" style={{ margin: 0 }}>Connect a Facebook Page on the <a href="/dashboard/connect">Channels</a> page first — click-to-chat ads run from a Page.</div>}

        <label>Product to promote<br />
          <select name="item_id" value={itemId} onChange={(e) => setItemId(e.target.value)} required style={{ width: "100%" }}>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>

        <label>Where the ad sends people<br />
          <select name="destination" value={destination} onChange={(e) => setDestination(e.target.value)} style={{ width: "100%" }}>
            <option value="whatsapp">WhatsApp chat</option>
            <option value="messenger">Messenger chat</option>
            <option value="instagram">Instagram DM</option>
          </select>
        </label>

        <label>Who should see it<br />
          <select name="audience" defaultValue="everyone" style={{ width: "100%" }}>
            {AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </label>

        <label>Daily budget ({cur})<br />
          <input name="budget" type="number" min="1" step="1" value={budget} onChange={(e) => setBudget(Number(e.target.value))} required style={{ width: "100%" }} />
          <span style={{ color: "var(--ink-70)", fontSize: 12 }}>{budgetHint}</span>
        </label>

        <label>Ad text<br />
          <textarea name="message" rows={3} maxLength={600} value={message} onChange={(e) => setMessage(e.target.value)} required style={{ width: "100%" }} />
        </label>

        {item && !item.imageUrl && <div className="notice notice-bad" role="alert" style={{ margin: 0 }}>This product has no photo, and Meta needs one for the ad. Add a photo in your <a href="/dashboard/catalogue">Catalogue</a> or pick another product.</div>}
        {cur !== "NGN" && <div style={{ fontSize: 12.5, color: "#8A5A0B", background: "#FBF0DC", borderRadius: 8, padding: "8px 10px" }}>This ad account bills in {cur}, so the budget is in {cur}, not Naira. For Nigerian ads, pick your NGN account above.</div>}
        <button className="btn btn-lime" disabled={!hasPage || !item?.imageUrl}>Create draft campaign</button>
        <p style={{ color: "var(--ink-70)", fontSize: 13, margin: 0 }}>Created paused. You review and switch it on in Meta Ads Manager — nothing spends until then.</p>
      </form>

      <div>
        <div style={{ fontSize: 12, color: "var(--ink-70)", marginBottom: 6 }}>Live preview</div>
        <div style={{ border: "1px solid var(--line, #e5e5e5)", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
          <div style={{ padding: "8px 12px", fontSize: 13, fontWeight: 600 }}>{pages[0]?.display_name ?? "Your Page"}</div>
          {item?.imageUrl
            ? <img src={item.imageUrl} alt="" style={{ width: "100%", height: 180, objectFit: "cover", display: "block" }} />
            : <div style={{ width: "100%", height: 180, background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center", color: "#999", fontSize: 13 }}>{item?.name ?? "Product photo"}</div>}
          <div style={{ padding: 12, fontSize: 14 }}>{message}</div>
          <div style={{ padding: 12, borderTop: "1px solid var(--line, #e5e5e5)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "var(--ink-70)" }}>{item?.name}</span>
            <span className="btn btn-sm" style={{ background: "#e7f3ff", color: "#1877f2", pointerEvents: "none" }}>{CTA[destination]}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
