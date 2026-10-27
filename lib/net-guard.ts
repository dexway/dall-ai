import { lookup } from "node:dns";
import { Agent, fetch as ufetch } from "undici";
// Pure IP checks for outbound fetches of user-supplied URLs (no server-only import, so tests can load it).
import { isIP } from "node:net";

const v4 = (ip: string) => ip.split(".").map(Number);

/** True for addresses a user-supplied URL must never reach: private, loopback, link-local, CGNAT, reserved, multicast. */
export function isBlockedIp(ip: string): boolean {
  let addr = ip.trim().toLowerCase();
  if (addr.startsWith("[") && addr.endsWith("]")) addr = addr.slice(1, -1);
  // IPv4-mapped IPv6 (::ffff:10.0.0.1 or ::ffff:a00:1) → judge the IPv4 inside.
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) addr = mapped[1];
  const hexMapped = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) { const a = parseInt(hexMapped[1], 16), b = parseInt(hexMapped[2], 16); addr = `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`; }

  const kind = isIP(addr);
  if (kind === 4) {
    const [a, b] = v4(addr);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||      // carrier-grade NAT
      (a === 169 && b === 254) ||                // link-local / cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||                  // 192.0.0.0/24 and 192.0.2.0/24
      (a === 198 && (b === 18 || b === 19)) ||   // benchmarking
      (a === 198 && b === 51) || (a === 203 && b === 0);
  }
  if (kind === 6) {
    return addr === "::" || addr === "::1" || /^f[cd]/.test(addr) || /^fe[89ab]/.test(addr) || /^ff/.test(addr) ||
      addr.startsWith("64:ff9b:") || addr.startsWith("2001:db8") || addr.startsWith("::ffff:");
  }
  return true; // not an IP at all: refuse
}

/** Rejects anything that isn't a plain http(s) URL on a normal port before any network call. */
export function checkUrlShape(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http and https links are allowed.");
  if (u.username || u.password) throw new Error("Links with a username or password aren't allowed.");
  if (u.port && !["80", "443", "8080", "8443"].includes(u.port)) throw new Error("That port isn't allowed.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isBlockedIp(host)) throw new Error("That address isn't public.");
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new Error("That address isn't public.");
  return u;
}

// Every connection's resolved IP is checked as the socket opens, so a name that resolves (or
// re-resolves) to a private address is refused, and each redirect hop is re-checked.
const guarded = new Agent({
  connect: {
    lookup(hostname, options, cb) {
      lookup(hostname, { ...options, all: true }, (err, addrs) => {
        if (err) return cb(err, "", 4);
        const list = (Array.isArray(addrs) ? addrs : [addrs]) as { address: string; family: number }[];
        const bad = list.find((a) => isBlockedIp(a.address));
        if (bad || !list.length) return cb(new Error("Blocked: that site points to a private address."), "", 4);
        if ((options as { all?: boolean }).all) return (cb as unknown as (e: null, a: typeof list) => void)(null, list);
        cb(null, list[0].address, list[0].family);
      });
    },
  },
});

/** Fetches a public web page's text: http(s) only, public IPs only, max 3 redirects, 10 s, 1.5 MB. */
export async function fetchPublicPage(raw: string, maxBytes = 1_500_000): Promise<string> {
  let url = checkUrlShape(raw);
  for (let hop = 0; hop <= 3; hop++) {
    const res = await ufetch(url, { dispatcher: guarded, redirect: "manual", headers: { "User-Agent": "DallAI-bot/1.0" }, signal: AbortSignal.timeout(10_000) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("Redirect without a location.");
      url = checkUrlShape(new URL(loc, url).toString());
      continue;
    }
    if (!res.ok) throw new Error(`The site answered ${res.status}.`);
    const reader = res.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); break; }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  throw new Error("Too many redirects.");
}
