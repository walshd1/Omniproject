import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { contentSecurityPolicy, cspHeaderName } from "./csp";

const KEYS = ["CONTENT_SECURITY_POLICY", "CSP_IMG_SRC", "CSP_CONNECT_SRC", "CSP_REPORT_ONLY", "CSP_REPORT_URI"];
afterEach(() => { for (const k of KEYS) delete process.env[k]; });

test("the default policy is strict but SPA-compatible", () => {
  const csp = contentSecurityPolicy();
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /base-uri 'self'/);
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

test("report-only mode switches the header name", () => {
  assert.equal(cspHeaderName(), "Content-Security-Policy");
  process.env["CSP_REPORT_ONLY"] = "1";
  assert.equal(cspHeaderName(), "Content-Security-Policy-Report-Only");
});
