import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { contentSecurityPolicy, cspHeaderName, cspNonce } from "./csp";

const KEYS = ["CONTENT_SECURITY_POLICY", "CSP_IMG_SRC", "CSP_CONNECT_SRC", "CSP_REPORT_ONLY", "CSP_REPORT_URI", "CSP_FRAME_SRC"];
afterEach(() => { for (const k of KEYS) delete process.env[k]; });

test("the default policy is strict but SPA-compatible", () => {
  const csp = contentSecurityPolicy();
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /base-uri 'self'/);
  // No third-party framing by default (native-handoff embed is opt-in per deployment).
  assert.match(csp, /frame-src 'none'/);
});

test("CSP_FRAME_SRC REPLACES the 'none' default (appending to 'none' would be invalid)", () => {
  process.env["CSP_FRAME_SRC"] = "https://miro.com https://app.powerbi.com";
  const csp = contentSecurityPolicy();
  assert.match(csp, /frame-src https:\/\/miro\.com https:\/\/app\.powerbi\.com/);
  assert.doesNotMatch(csp.match(/frame-src[^;]*/)?.[0] ?? "", /'none'/);
});

test("a full override is used verbatim", () => {
  process.env["CONTENT_SECURITY_POLICY"] = "default-src 'none'";
  assert.equal(contentSecurityPolicy(), "default-src 'none'");
});

test("extra sources append to a directive", () => {
  process.env["CSP_CONNECT_SRC"] = "https://api.example.com";
  assert.match(contentSecurityPolicy(), /connect-src 'self' https:\/\/api\.example\.com/);
});

test("a report-uri is added when configured", () => {
  process.env["CSP_REPORT_URI"] = "/csp-report";
  assert.match(contentSecurityPolicy(), /report-uri \/csp-report/);
});

test("a per-request nonce is added to script-src (defence-in-depth) but never to style-src", () => {
  const nonce = cspNonce();
  const csp = contentSecurityPolicy(nonce);
  assert.match(csp, new RegExp(`script-src 'self' 'nonce-${nonce.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}'`));
  // style-src keeps 'unsafe-inline' and gets no nonce (a nonce there would disable it,
  // breaking React/Tailwind inline style attributes).
  assert.match(csp, /style-src 'self' 'unsafe-inline'/);
  assert.doesNotMatch(csp.match(/style-src[^;]*/)?.[0] ?? "", /nonce-/);
});

test("cspNonce is fresh and base64 each call", () => {
  const a = cspNonce();
  const b = cspNonce();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9+/]+=*$/);
});

test("no nonce is added when none is supplied", () => {
  assert.doesNotMatch(contentSecurityPolicy(), /nonce-/);
});

test("report-only mode switches the header name", () => {
  assert.equal(cspHeaderName(), "Content-Security-Policy");
  process.env["CSP_REPORT_ONLY"] = "1";
  assert.equal(cspHeaderName(), "Content-Security-Policy-Report-Only");
});
