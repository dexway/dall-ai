// Website → agent knowledge: prices in plain divs survive, menus/footers aren't repeated, links are ranked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pageLines, knowledgeFromPages, rankLinks, decodeEntities } from "../lib/site-knowledge.ts";

const shell = (title: string, main: string) => `<html><head><title>${title}</title><style>.x{}</style></head><body>
<nav><a href="/">Home</a><a href="/rooms/">Rooms</a><a href="/halls/">Halls</a></nav>
<script>var tracking = 1;</script>${main}
<footer><div>48, Oritshe Street, Ikeja. Lagos</div><div>09060003710</div></footer></body></html>`;

const home = shell("WaterCress &#8211; Home", "<h1>Your Serene Retreat</h1><p>Delivering hospitality, not just expectation.</p>");
const deluxe = shell("Deluxe Room", `<h1>Deluxe Room</h1><div class="price"><span>Price from</span> <span>&#8358; 230,000.00</span> <span>Night</span></div><ul><li>52 sqm</li><li>1 Bed</li><li>Bathtub/Shower</li></ul>`);
const royal = shell("Royal Suite", `<h1>Royal Suite</h1><div>Price from &#x20a6; 180,000.00 Night</div><div>Swimming Pool</div>`);

test("prices in plain divs and entities are kept", () => {
  const { title, lines } = pageLines(deluxe);
  assert.equal(title, "Deluxe Room");
  assert.ok(lines.includes("Price from ₦ 230,000.00 Night"), lines.join("|"));
  assert.ok(lines.includes("52 sqm") && lines.includes("Bathtub/Shower"));
  assert.ok(!lines.some((l) => l.includes("tracking") || l.includes(".x{}")));
  assert.equal(decodeEntities("WaterCress &#8211; Home &amp; more"), "WaterCress – Home & more");
});

test("every page becomes a section; shared menu and footer appear once", () => {
  const k = knowledgeFromPages([{ url: "https://w.com/", html: home }, { url: "https://w.com/rooms/deluxe/", html: deluxe }, { url: "https://w.com/rooms/royal/", html: royal }]);
  assert.match(k, /## Deluxe Room[\s\S]*₦ 230,000\.00[\s\S]*## Royal Suite[\s\S]*Price from ₦ 180,000\.00 Night/);
  assert.equal(k.match(/09060003710/g)?.length, 1);
  assert.ok(knowledgeFromPages([{ url: "a", html: home }], 200).length <= 200);
});

test("links: same site only, duplicates and junk dropped, sales pages first", () => {
  const r = rankLinks(["https://www.w.com/blog/x", "https://w.com/index.php/rooms/", "https://w.com/rooms/", "https://other.com/rooms", "https://w.com/feed/", "https://w.com/booking-cart/", "https://w.com/contact-us/"], "https://www.w.com/");
  assert.deepEqual(r, ["https://w.com/index.php/rooms/", "https://w.com/contact-us/", "https://www.w.com/blog/x"]);
});
