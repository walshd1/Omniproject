import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Dev-mode route gating — drives the REAL Express app over HTTP with dev mode
 * force-armed (OMNI_DEV_MODE=1, NODE_ENV != production) and OIDC configured (so
 * roles come from claims, not the demo "every session is admin" shortcut).
 *
 * Asserts the zero-trust tightening: being authenticated at all must not imply
 * read access to dev internals (impersonation state, entitlement overrides), and
 * starting an impersonation — the single highest-risk action in the app, since it
 * assumes a whole other identity — requires a FRESH step-up on top of the admin
 * role, exactly like every other identity/security-altering admin action.
 */
const SECRET = "test-session-secret-dev-mode";
process.env["SESSION_SECRET"] = SECRET;
process.env["OIDC_ISSUER_URL"] = "https://idp.test/realm";
process.env["OIDC_ADMIN_ROLES"] = "omni-admins";
process.env["OIDC_DEFAULT_ROLE"] = "viewer";
process.env["NODE_ENV"] = "development"; // dev mode is hard-gated off in production
process.env["OMNI_DEV_MODE"] = "1"; // force dev mode on regardless of other debug flags
// Dev mode + real OIDC is a "looks like production" combo the boot guard (dev-mode-guard.ts)
// refuses by default — this test needs real OIDC-derived roles (not demo's blanket grant)
// to exercise viewer-vs-admin gating, so it acknowledges the guard like local testing would.
process.env["OMNI_DEV_MODE_ACK_INSECURE"] = "1";
process.env["RATE_LIMIT_DISABLED"] = "true";

let server: Server;
let base: string;

function signedSessionCookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}

const VIEWER = signedSessionCookie({ sub: "viewer-1", roles: [] });
const ADMIN_FRESH = signedSessionCookie({ sub: "admin-1", roles: ["omni-admins"], stepUpAt: Date.now() });
const ADMIN_STALE = signedSessionCookie({ sub: "admin-2", roles: ["omni-admins"] });

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
});

const req = (path: string, init?: RequestInit) => fetch(`${base}${path}`, { ...init, headers: { cookie: "", ...init?.headers } });
const withCookie = (cookie: string, init?: RequestInit) => ({ ...init, headers: { cookie, ...init?.headers } });

test("GET /api/dev-mode reports devMode:true once force-armed", async () => {
  const res = await req("/api/dev-mode", withCookie(VIEWER));
  const json = (await res.json()) as { devMode: boolean };
  assert.equal(json.devMode, true);
});

test("GET /api/dev-mode/impersonate: an unrelated viewer with no active impersonation is refused", async () => {
  const res = await req("/api/dev-mode/impersonate", withCookie(VIEWER));
  assert.equal(res.status, 403);
});

test("GET /api/dev-mode/impersonate: a real admin may always read it (even with none active)", async () => {
  const res = await req("/api/dev-mode/impersonate", withCookie(ADMIN_FRESH));
  assert.equal(res.status, 200);
  const json = (await res.json()) as { impersonation: unknown };
  assert.equal(json.impersonation, null);
});

test("GET /api/dev-mode/entitlements is admin-only", async () => {
  const asViewer = await req("/api/dev-mode/entitlements", withCookie(VIEWER));
  assert.equal(asViewer.status, 403);
  const asAdmin = await req("/api/dev-mode/entitlements", withCookie(ADMIN_FRESH));
  assert.equal(asAdmin.status, 200);
});

test("POST /api/dev-mode/impersonate: a stale (non-fresh) admin step-up is refused", async () => {
  const res = await req("/api/dev-mode/impersonate", withCookie(ADMIN_STALE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sub: "target-1", reason: "reproduce a bug" }),
  }));
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as { code?: string }).code, "step_up_required");
});

test("POST /api/dev-mode/impersonate: a plain viewer is refused regardless of step-up freshness", async () => {
  const res = await req("/api/dev-mode/impersonate", withCookie(VIEWER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sub: "target-1", reason: "reproduce a bug" }),
  }));
  assert.equal(res.status, 403);
});

test("POST /api/dev-mode/impersonate: a freshly step-up admin starts an impersonation, then GET reflects it for the impersonated session", async () => {
  const start = await req("/api/dev-mode/impersonate", withCookie(ADMIN_FRESH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sub: "target-1", roles: ["viewer"], reason: "reproduce a viewer-only bug" }),
  }));
  assert.equal(start.status, 200);
  // The response sets several cookies (CSRF rotation, then the session again after
  // impersonation is attached) — take the LAST omni_session, exactly as a real
  // browser would apply Set-Cookie headers in order for the same cookie name.
  const setCookies = start.headers.getSetCookie();
  const sessionCookie = [...setCookies].reverse().find((c) => c.startsWith("omni_session="));
  assert.ok(sessionCookie, "impersonation must stamp a new session cookie");
  const impersonatedCookie = sessionCookie!.split(";")[0]!;

  // The now-impersonated (effectively viewer) session can still read its OWN active
  // impersonation — that's the banner the UI shows while masquerading.
  const check = await req("/api/dev-mode/impersonate", withCookie(impersonatedCookie));
  assert.equal(check.status, 200);
  const json = (await check.json()) as { impersonation: { sub: string; reason: string } | null };
  assert.equal(json.impersonation?.sub, "target-1");
  assert.equal(json.impersonation?.reason, "reproduce a viewer-only bug");
});
