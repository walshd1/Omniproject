import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { ipInCidr, ipAllowed, ipAllowlist, clientIp, ipAllowGuard } from "./ip-allow";

afterEach(() => { delete process.env["IP_ALLOWLIST"]; delete process.env["TRUST_PROXY"]; });

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

test("ipInCidr rejects malformed IPv4 octets and wrong part counts", () => {
  assert.equal(ipInCidr("10.0.0.256", "10.0.0.0/24"), false); // octet > 255
  assert.equal(ipInCidr("10.0.0.x", "10.0.0.0/24"), false); // non-numeric octet
  assert.equal(ipInCidr("10.0.0", "10.0.0.0/24"), false); // only 3 parts
  assert.equal(ipInCidr("10.0.0.1", "not-a-network/24"), false); // unparseable base
});

test("ipInCidr rejects malformed IPv6 (multiple '::', bad group, wrong length)", () => {
  assert.equal(ipInCidr("2001::db8::1", "2001:db8::/32"), false); // two '::'
  assert.equal(ipInCidr("2001:db8::zzzz", "2001:db8::/32"), false); // non-hex group
  assert.equal(ipInCidr("2001:db8:1:2:3", "2001:db8::/32"), false); // no '::' and < 8 groups
  assert.equal(ipInCidr("::ffff:999.1.1.1", "10.0.0.0/24"), false); // invalid embedded IPv4
});

test("ipInCidr rejects an out-of-range prefix", () => {
  assert.equal(ipInCidr("10.0.0.1", "10.0.0.0/33"), false); // >32 for IPv4
  assert.equal(ipInCidr("10.0.0.1", "10.0.0.0/-1"), false); // negative
});

test("clientIp uses the socket peer by default and X-Forwarded-For under TRUST_PROXY", () => {
  const req = { socket: { remoteAddress: "::ffff:203.0.113.9" }, headers: {} } as unknown as Request;
  assert.equal(clientIp(req), "203.0.113.9"); // IPv4-mapped normalised

  process.env["TRUST_PROXY"] = "1";
  const proxied = { socket: { remoteAddress: "10.0.0.1" }, headers: { "x-forwarded-for": "198.51.100.7, 10.0.0.1" } } as unknown as Request;
  assert.equal(clientIp(proxied), "198.51.100.7"); // first hop

  // TRUST_PROXY explicitly disabled falls back to the socket peer.
  process.env["TRUST_PROXY"] = "false";
  assert.equal(clientIp(proxied), "10.0.0.1");
});

test("ipAllowGuard: passes through when off, allows a listed IP, 403s an unlisted one", () => {
  const mkRes = () => {
    const r = { code: 0, body: null as unknown, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; } };
    return r;
  };
  const req = { socket: { remoteAddress: "10.0.0.5" }, headers: {}, path: "/api/x" } as unknown as Request;

  // Off (no list) → next().
  let nexted = false;
  ipAllowGuard(req, mkRes() as unknown as Response, () => { nexted = true; });
  assert.equal(nexted, true);

  process.env["IP_ALLOWLIST"] = "10.0.0.0/24";
  nexted = false;
  ipAllowGuard(req, mkRes() as unknown as Response, () => { nexted = true; });
  assert.equal(nexted, true); // allowed

  const blocked = { socket: { remoteAddress: "203.0.113.1" }, headers: {}, path: "/api/x" } as unknown as Request;
  const res = mkRes();
  let blockedNext = false;
  ipAllowGuard(blocked, res as unknown as Response, () => { blockedNext = true; });
  assert.equal(blockedNext, false);
  assert.equal(res.code, 403);
});
