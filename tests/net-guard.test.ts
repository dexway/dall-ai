// SSRF guard for "Learn from website". Pure checks plus the real fetch path against blocked targets
// (blocked before any connection is made, so no network access is needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlockedIp, checkUrlShape, fetchPublicPage } from "../lib/net-guard.ts";

test("private, loopback, link-local, CGNAT, reserved and mapped addresses are blocked; public ones pass", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
    "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:a9fe:a9fe", "[::1]", "not-an-ip"]) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "102.89.32.10", "172.32.0.1", "2a00:1450:4001:80b::200e"]) assert.equal(isBlockedIp(ip), false, ip);
});

test("URL shape: only plain http(s) to public hosts on normal ports", () => {
  assert.equal(checkUrlShape("https://shop.example.com/about").hostname, "shop.example.com");
  for (const bad of ["file:///etc/passwd", "ftp://x.com", "gopher://x", "http://user:pw@x.com", "http://x.com:6379",
    "http://127.0.0.1/", "http://2130706433/", "http://0x7f000001/", "http://[::1]/", "http://169.254.169.254/latest/meta-data",
    "http://localhost:3000", "http://db.internal/", "http://printer.local/"]) {
    assert.throws(() => checkUrlShape(bad), bad);
  }
});

test("the fetch refuses blocked targets before connecting", async () => {
  for (const bad of ["http://127.0.0.1/", "http://2130706433/", "http://[::ffff:127.0.0.1]/", "http://localhost/"]) {
    await assert.rejects(fetchPublicPage(bad), bad);
  }
});
