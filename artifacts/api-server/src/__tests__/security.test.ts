import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Security suite — drives the REAL Express app over HTTP and asserts the
 * gateway's protections HOLD. These tests must only ever tighten: a regression
 * that loosens a gate (viewer can write, a read-only token can mutate, a missing
 * security header) fails CI.
 *
 * The env below is set BEFORE importing the app so module-load-time config
 * (SESSION_SECRET, API_TOKENS, OIDC mode) is picked up:
 *  - OIDC_ISSUER_URL set  -> non-demo, so roles derive from session claims
 *    (demo sessions are always admin, which would hide every RBAC gate).
 *  - OIDC_DEFAULT_ROLE=viewer -> a claim-less session is a viewer.
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["API_TOKENS"] = "ro-token-aaa,ro-token-bbb";
process.env["OIDC_ISSUER_URL"] = "https://idp.test/realm";
process.env["OIDC_ADMIN_ROLES"] = "omni-admins";
process.env["OIDC_DEFAULT_ROLE"] = "viewer";
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true"; // isolate auth behaviour from the limiter

let server: Server;
let base: string;

// Replicate cookie-parser's signed-cookie format (s:<value>.<base64 hmac>) so we
// can mint sessions for arbitrary roles without going through the OIDC flow.
function signedSessionCookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  const signed = "s:" + value + "." + mac;
  return `omni_session=${encodeURIComponent(signed)}`;
}

const VIEWER = signedSessionCookie({ sub: "viewer-1", roles: [] });
const ADMIN = signedSessionCookie({ sub: "admin-1", roles: ["omni-admins"] });

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
});

const req = (path: string, init?: RequestInit) => fetch(`${base}${path}`, init);

test("unauthenticated request to a protected route is 401", async () => {
  const res = await req("/api/projects");
  assert.equal(res.status, 401);
});

test("a session (any role) can read", async () => {
  const res = await req("/api/projects", { headers: { cookie: VIEWER } });
  assert.equal(res.status, 200);
});

test("RBAC: a viewer CANNOT create an issue (403)", async () => {
  const res = await req("/api/projects/proj-1/issues", {
    method: "POST",
    headers: { cookie: VIEWER, "content-type": "application/json" },
    body: JSON.stringify({ title: "should be blocked" }),
  });
  assert.equal(res.status, 403);
});

test("RBAC: a viewer CANNOT change settings (admin gate, 403)", async () => {
  const res = await req("/api/settings", {
    method: "PATCH",
    headers: { cookie: VIEWER, "content-type": "application/json" },
    body: JSON.stringify({ brokerUrl: "http://evil.example" }),
  });
  assert.equal(res.status, 403);
});

test("RBAC: an admin is NOT blocked by the contributor gate", async () => {
  // Admin clears requireRole("contributor"); it may still 400/404 downstream, but
  // it must NOT be the 403 authorization wall.
  const res = await req("/api/projects/proj-1/issues", {
    method: "POST",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ title: "allowed past the gate" }),
  });
  assert.notEqual(res.status, 403);
});

test("read-only API token can GET", async () => {
  const res = await req("/api/projects", { headers: { "x-api-key": "ro-token-aaa" } });
  assert.equal(res.status, 200);
});

test("read-only API token CANNOT mutate (403)", async () => {
  const res = await req("/api/projects/proj-1/issues", {
    method: "POST",
    headers: { "x-api-key": "ro-token-aaa", "content-type": "application/json" },
    body: JSON.stringify({ title: "leaked BI token must not write" }),
  });
  assert.equal(res.status, 403);
});

test("an invalid API token is unauthorized (401)", async () => {
  const res = await req("/api/projects", { headers: { "x-api-key": "not-a-real-token" } });
  assert.equal(res.status, 401);
});

test("baseline security headers are present", async () => {
  const res = await req("/api/healthz");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.match(res.headers.get("referrer-policy") ?? "", /strict-origin/);
  assert.ok(res.headers.get("permissions-policy"));
  // HSTS only in production (set above).
  assert.match(res.headers.get("strict-transport-security") ?? "", /max-age=\d+/);
});
