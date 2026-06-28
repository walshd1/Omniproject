import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ipInCidr, ipAllowed, ipAllowlist } from "./ip-allow";

afterEach(() => { delete process.env["IP_ALLOWLIST"]; });

test("IPv4 CIDR matching", () => {
  assert.equal(ipInCidr("10.0.0.5", "10.0.0.0/24"), true);
  assert.equal(ipInCidr("10.0.1.5", "10.0.0.0/24"), false);
  assert.equal(ipInCidr("192.168.1.1", "192.168.1.1"), true); // bare IP = /32
  assert.equal(ipInCidr("192.168.1.2", "192.168.1.1"), false);
  assert.equal(ipInCidr("1.2.3.4", "0.0.0.0/0"), true); // match-all
});

test("IPv6 CIDR matching (incl. IPv4-mapped)", () => {
  assert.equal(ipInCidr("2001:db8::1", "2001:db8::/32"), true);
  assert.equal(ipInCidr("2001:db9::1", "2001:db8::/32"), false);
  assert.equal(ipInCidr("::1", "::1"), true);
  // an IPv4-mapped IPv6 client matches an IPv4 rule
  assert.equal(ipInCidr("::ffff:10.0.0.5", "10.0.0.0/24"), true);
});

test("mixed families never match", () => {
  assert.equal(ipInCidr("10.0.0.5", "2001:db8::/32"), false);
});

test("ipAllowed: empty list allows everything; a set list gates", () => {
  assert.equal(ipAllowlist().length, 0);
  assert.equal(ipAllowed("8.8.8.8"), true); // feature off
  process.env["IP_ALLOWLIST"] = "10.0.0.0/8, 192.168.1.5";
  assert.equal(ipAllowed("10.1.2.3"), true);
  assert.equal(ipAllowed("192.168.1.5"), true);
  assert.equal(ipAllowed("172.16.0.1"), false);
});

test("a malformed allowlist entry doesn't match (fails closed for that entry)", () => {
  process.env["IP_ALLOWLIST"] = "not-an-ip";
  assert.equal(ipAllowed("10.0.0.1"), false);
});
