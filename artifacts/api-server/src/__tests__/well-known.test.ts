import { test } from "node:test";
import assert from "node:assert/strict";
import { securityTxt, wellKnownRouter } from "../routes/well-known";

/**
 * security.txt (RFC 9116) tests — the public invitation to audit/pentest must
 * carry the required fields and a valid, future Expires, and the route must serve
 * it as plaintext.
 */

test("securityTxt carries the RFC 9116 required fields", () => {
  const body = securityTxt(new Date("2026-01-01T00:00:00Z"));
  assert.match(body, /^Contact: https:\/\//m);
  assert.match(body, /^Policy: https:\/\//m);
  assert.match(body, /^Expires: /m);
  assert.match(body, /welcomes independent code audit and penetration testing/);
});

test("securityTxt Expires is ~one year out and ISO-8601", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const line = securityTxt(now).split("\n").find((l) => l.startsWith("Expires:"))!;
  const expires = new Date(line.replace("Expires:", "").trim());
  assert.ok(expires > now, "Expires must be in the future");
  const days = (expires.getTime() - now.getTime()) / 86_400_000;
  assert.ok(days >= 364 && days <= 366, `Expires should be ~1 year out, got ${days} days`);
});

test("the route serves security.txt as text/plain", () => {
  // The router exposes one GET handler; exercise it with a minimal fake req/res.
  const stack = (wellKnownRouter as unknown as { stack: Array<{ route?: { stack: Array<{ handle: (req: unknown, res: unknown, next: () => void) => void }> } }> }).stack;
  const layer = stack.find((l) => l.route);
  assert.ok(layer?.route, "expected a registered route");
  let type = "";
  let sent = "";
  const res = {
    type(t: string) { type = t; return res; },
    send(b: string) { sent = b; return res; },
  };
  layer.route.stack[0]!.handle({}, res, () => {});
  assert.equal(type, "text/plain");
  assert.match(sent, /Contact: /);
});
