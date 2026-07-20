import { test } from "node:test";
import assert from "node:assert/strict";
import { isLinkLocalIPv4, isLinkLocalIPv6, isBlockedHostLiteral, isBlockedIp, isPrivateOrLoopbackIPv4, isPrivateOrLoopbackIPv6, isPrivateOrLoopbackIp, isPrivateOrLoopbackHostLiteral } from "./ip-ranges";

test("isLinkLocalIPv4: 169.254.0.0/16 (incl. AWS/GCP/Azure IMDS + ECS metadata)", () => {
  assert.equal(isLinkLocalIPv4("169.254.169.254"), true); // AWS/GCP/Azure/DO IMDS
  assert.equal(isLinkLocalIPv4("169.254.170.2"), true); // AWS ECS task metadata
  assert.equal(isLinkLocalIPv4("169.254.0.0"), true);
  assert.equal(isLinkLocalIPv4("169.254.255.255"), true);
});

test("isLinkLocalIPv4: adjacent ranges are NOT blocked (legitimate private/public space)", () => {
  assert.equal(isLinkLocalIPv4("169.253.169.254"), false);
  assert.equal(isLinkLocalIPv4("169.255.0.1"), false);
  assert.equal(isLinkLocalIPv4("10.0.0.1"), false); // RFC1918 — legitimately reachable (self-hosted broker)
  assert.equal(isLinkLocalIPv4("192.168.1.1"), false);
});

test("isLinkLocalIPv6: fe80::/10 link-local, correctly bounded (fe80..febf, not fec0..)", () => {
  assert.equal(isLinkLocalIPv6("fe80::1"), true);
  assert.equal(isLinkLocalIPv6("fe80::"), true);
  assert.equal(isLinkLocalIPv6("febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), true); // top of the /10
  assert.equal(isLinkLocalIPv6("fec0::1"), false); // deprecated site-local — a DIFFERENT /10, not link-local
  assert.equal(isLinkLocalIPv6("fc00::1"), false); // unique-local — legitimately reachable
});

test("isLinkLocalIPv6: the exact AWS IMDSv2 IPv6 address", () => {
  assert.equal(isLinkLocalIPv6("fd00:ec2::254"), true);
  assert.equal(isLinkLocalIPv6("fd00:ec2::255"), false); // one off — must be exact
  assert.equal(isLinkLocalIPv6("fd00:ec3::254"), false);
});

test("isLinkLocalIPv6: IPv4-mapped 169.254.0.0/16 is caught (the reported bypass)", () => {
  assert.equal(isLinkLocalIPv6("::ffff:a9fe:a9fe"), true); // ::ffff:169.254.169.254 in hex form
  assert.equal(isLinkLocalIPv6("::ffff:169.254.169.254".replace("169.254.169.254", "a9fe:a9fe")), true);
  assert.equal(isLinkLocalIPv6("::ffff:a9fd:a9fe"), false); // mapped 169.253.x.x — not link-local
});

test("isLinkLocalIPv6: unrelated/malformed input never throws and is not blocked", () => {
  assert.equal(isLinkLocalIPv6("::1"), false); // loopback — not this guard's concern
  assert.equal(isLinkLocalIPv6("not-an-ip"), false);
  assert.equal(isLinkLocalIPv6(""), false);
});

test("isBlockedHostLiteral: dispatches by family and covers known metadata hostnames", () => {
  assert.equal(isBlockedHostLiteral("169.254.169.254"), true);
  assert.equal(isBlockedHostLiteral("fe80::1"), true);
  assert.equal(isBlockedHostLiteral("::ffff:a9fe:a9fe"), true);
  assert.equal(isBlockedHostLiteral("metadata.google.internal"), true);
  assert.equal(isBlockedHostLiteral("metadata"), true);
  assert.equal(isBlockedHostLiteral("example.com"), false); // a plain hostname is never a "literal" — see isBlockedIp
  assert.equal(isBlockedHostLiteral("10.0.0.5"), false);
});

test("isBlockedIp: validates a resolved DNS address by family (the DNS-rebinding closer)", () => {
  assert.equal(isBlockedIp("169.254.169.254", 4), true);
  assert.equal(isBlockedIp("fe80::1", 6), true);
  assert.equal(isBlockedIp("8.8.8.8", 4), false);
  assert.equal(isBlockedIp("2001:4860:4860::8888", 6), false);
});

test("isPrivateOrLoopbackIPv4: RFC1918 + loopback + CGNAT + this-host, excludes public", () => {
  for (const ip of ["10.0.0.5", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.1.1", "127.0.0.1", "0.0.0.0", "100.64.0.1"]) {
    assert.equal(isPrivateOrLoopbackIPv4(ip), true, `${ip} should be private/loopback`);
  }
  for (const ip of ["8.8.8.8", "93.184.216.34", "172.15.0.1", "172.32.0.1", "192.169.0.1", "100.63.0.1", "100.128.0.1"]) {
    assert.equal(isPrivateOrLoopbackIPv4(ip), false, `${ip} should be public`);
  }
  assert.equal(isPrivateOrLoopbackIPv4("not-an-ip"), false);
});

test("isPrivateOrLoopbackIPv6: ::1, fc00::/7 ULA, IPv4-mapped private; excludes public", () => {
  assert.equal(isPrivateOrLoopbackIPv6("::1"), true);
  assert.equal(isPrivateOrLoopbackIPv6("fc00::1"), true);
  assert.equal(isPrivateOrLoopbackIPv6("fd12:3456::1"), true);
  assert.equal(isPrivateOrLoopbackIPv6("::ffff:a00:5"), true); // IPv4-mapped 10.0.0.5 in canonical hex (as URL.hostname produces)
  assert.equal(isPrivateOrLoopbackIPv6("2001:4860:4860::8888"), false); // public
  assert.equal(isPrivateOrLoopbackIPv6("fe80::1"), false); // link-local is the ALWAYS-ON floor, not this set
});

test("isPrivateOrLoopbackIp / HostLiteral: dispatch by family; a plain hostname is not a literal", () => {
  assert.equal(isPrivateOrLoopbackIp("10.0.0.5", 4), true);
  assert.equal(isPrivateOrLoopbackIp("::1", 6), true);
  assert.equal(isPrivateOrLoopbackIp("8.8.8.8", 4), false);
  assert.equal(isPrivateOrLoopbackHostLiteral("127.0.0.1"), true);
  assert.equal(isPrivateOrLoopbackHostLiteral("n8n"), false); // resolved separately
});
