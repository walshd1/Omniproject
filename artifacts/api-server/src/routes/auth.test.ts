import { test } from "node:test";
import assert from "node:assert/strict";
import { safeLocalPath, resolveBaseUrl, InsecureBaseUrlError } from "./auth";

/** Open-redirect guard for the post-auth `returnTo` (CWE-601). */
test("safeLocalPath keeps a same-origin path", () => {
  assert.equal(safeLocalPath("/projects"), "/projects");
  assert.equal(safeLocalPath("/a/b?c=d#e"), "/a/b?c=d#e");
});

test("safeLocalPath rejects absolute, protocol-relative and scheme URLs", () => {
  for (const evil of [
    "https://evil.example/phish",
    "http://evil.example",
    "//evil.example",            // protocol-relative
    "/\\evil.example",           // backslash trick (browsers normalise to //)
    "javascript:alert(1)",
    "data:text/html,x",
    "evil.example",              // no leading slash
    "",
    null,
    undefined,
    123,
  ]) {
    assert.equal(safeLocalPath(evil as unknown), "/", String(evil));
  }
});

test("safeLocalPath strips control-char (CR/LF/tab) smuggling", () => {
  assert.equal(safeLocalPath("/ok\r\nSet-Cookie: x=1"), "/");
  assert.equal(safeLocalPath("/ok\tx"), "/");
});

/**
 * Host-header injection → magic-link/OAuth-redirect account takeover (CWE-644). When
 * PUBLIC_URL isn't set, the base URL used to build these security-sensitive links must
 * never come from an unauthenticated attacker's own Host/X-Forwarded-Host header.
 */
const base = (overrides: Partial<Parameters<typeof resolveBaseUrl>[0]> = {}) =>
  resolveBaseUrl({
    configured: undefined,
    productionLike: false,
    trustProxy: false,
    forwardedProto: undefined,
    forwardedHost: undefined,
    reqProtocol: "http",
    rawHost: "localhost:5000",
    ...overrides,
  });

test("resolveBaseUrl: PUBLIC_URL is always authoritative (trailing slash trimmed)", () => {
  assert.equal(base({ configured: "https://omni.example.com/" }), "https://omni.example.com");
  // ...even with a hostile Host header present — PUBLIC_URL wins outright.
  assert.equal(base({ configured: "https://omni.example.com", rawHost: "evil.attacker.example" }), "https://omni.example.com");
});

test("resolveBaseUrl: production-like + no PUBLIC_URL is a hard failure, not a header-trusting fallback", () => {
  assert.throws(() => base({ productionLike: true }), InsecureBaseUrlError);
  // The exact attack: an attacker calls /auth/magic/request for a VICTIM's email with a
  // spoofed Host header, hoping the server embeds it into the link mailed to the victim.
  assert.throws(
    () => base({ productionLike: true, rawHost: "evil.attacker.example" }),
    InsecureBaseUrlError,
  );
});

test("resolveBaseUrl: dev/demo fallback never trusts X-Forwarded-Host without an operator-confirmed proxy", () => {
  // trustProxy is false (the new default) ⇒ a spoofed X-Forwarded-Host is ignored outright,
  // even though PUBLIC_URL is unset and this isn't production-like.
  assert.equal(
    base({ trustProxy: false, forwardedHost: "evil.attacker.example", forwardedProto: "https" }),
    "http://localhost:5000",
  );
});

test("resolveBaseUrl: X-Forwarded-* is honoured ONLY once the operator opts into trusting a proxy", () => {
  assert.equal(
    base({ trustProxy: true, forwardedHost: "app.example.com", forwardedProto: "https" }),
    "https://app.example.com",
  );
  // A comma-separated X-Forwarded-Proto (multiple hops) — only the first (closest to the
  // original request) is used, matching how a well-formed proxy chain appends its own.
  assert.equal(base({ trustProxy: true, forwardedProto: "https, http" }), "https://localhost:5000");
});
