import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { csrfGuard, newCsrfToken } from "./csrf";
import type { Request, Response } from "express";

/**
 * CSRF guard: cookie-authenticated mutations must be same-origin and (when browser-
 * driven) carry the double-submit token; machine callers without a session cookie and
 * safe methods pass through.
 */
afterEach(() => {
  delete process.env["PUBLIC_URL"];
  delete process.env["CSRF_DISABLED"];
  delete process.env["CSRF_TRUSTED_ORIGINS"];
});

interface GuardOpts {
  method?: string; path?: string; session?: boolean; csrfCookie?: string; csrfHeader?: string;
  origin?: string; referer?: string; secFetch?: string; host?: string;
}

function run(opts: GuardOpts): { status: number | null; passed: boolean } {
  const headers: Record<string, string> = { host: opts.host ?? "app.example.com" };
  if (opts.origin) headers["origin"] = opts.origin;
  if (opts.referer) headers["referer"] = opts.referer;
  if (opts.secFetch) headers["sec-fetch-site"] = opts.secFetch;
  if (opts.csrfHeader) headers["x-csrf-token"] = opts.csrfHeader;
  const req = {
    method: opts.method ?? "POST",
    path: opts.path ?? "/api/issues",
    protocol: "https",
    headers,
    signedCookies: opts.session ? { omni_session: "s:sess" } : {},
    cookies: opts.csrfCookie ? { omni_csrf: opts.csrfCookie } : {},
    get(name: string) { return headers[name.toLowerCase()]; },
  } as unknown as Request;
  let status: number | null = null;
  let passed = false;
  const res = {
    status(code: number) { status = code; return this; },
    json(_b: unknown) { return this; },
  } as unknown as Response;
  csrfGuard(req, res, () => { passed = true; });
  return { status, passed };
}

test("safe methods pass regardless", () => {
  assert.equal(run({ method: "GET", session: true }).passed, true);
});

test("no session cookie ⇒ machine caller, passes (not CSRF-able)", () => {
  assert.equal(run({ method: "POST", session: false, origin: "https://evil.example" }).passed, true);
});

test("cross-origin session mutation is rejected", () => {
  const r = run({ session: true, origin: "https://evil.example", host: "app.example.com" });
  assert.equal(r.passed, false);
  assert.equal(r.status, 403);
});

test("same-origin browser mutation needs a matching double-submit token", () => {
  const tok = newCsrfToken();
  const ok = run({ session: true, origin: "https://app.example.com", csrfCookie: tok, csrfHeader: tok });
  assert.equal(ok.passed, true);
  const missing = run({ session: true, origin: "https://app.example.com", csrfCookie: tok });
  assert.equal(missing.passed, false);
  assert.equal(missing.status, 403);
  const mismatch = run({ session: true, origin: "https://app.example.com", csrfCookie: tok, csrfHeader: "other" });
  assert.equal(mismatch.passed, false);
});

test("an uppercase /API path is still CSRF-scoped (case-insensitive prefix, matching Express routing)", () => {
  // Express routes /API/... case-insensitively to the mutation handler; the guard must not skip it.
  const r = run({ session: true, path: "/API/issues", origin: "https://evil.example", host: "app.example.com" });
  assert.equal(r.passed, false);
  assert.equal(r.status, 403);
});

test("non-browser session call (no Origin/Referer/Sec-Fetch) passes — not a CSRF vector", () => {
  // e.g. curl/supertest with a cookie: cannot be tricked, so the token isn't demanded.
  assert.equal(run({ session: true }).passed, true);
});

test("Sec-Fetch-Site=cross-site without Origin is treated as browser-driven ⇒ token required", () => {
  const r = run({ session: true, secFetch: "cross-site" });
  assert.equal(r.passed, false);
  assert.equal(r.status, 403);
});

test("Referer is used when Origin is absent", () => {
  const r = run({ session: true, referer: "https://evil.example/x", host: "app.example.com" });
  assert.equal(r.passed, false);
});

test("PUBLIC_URL is accepted as our origin", () => {
  process.env["PUBLIC_URL"] = "https://canonical.example";
  const tok = newCsrfToken();
  const r = run({ session: true, origin: "https://canonical.example", csrfCookie: tok, csrfHeader: tok, host: "internal:3000" });
  assert.equal(r.passed, true);
});

test("CSRF_DISABLED short-circuits the guard", () => {
  process.env["CSRF_DISABLED"] = "1";
  assert.equal(run({ session: true, origin: "https://evil.example" }).passed, true);
});
