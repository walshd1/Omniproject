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

test("the broker contract is public and reports a version + JSON Schema", async () => {
  const res = await req("/api/contract"); // no cookie — public
  assert.equal(res.status, 200);
  const body = (await res.json()) as { version: string; schema: { $defs?: Record<string, unknown> } };
  assert.equal(body.version, "v1");
  assert.ok(body.schema && body.schema.$defs && Object.keys(body.schema.$defs).length > 0, "schema has $defs");
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

test("RBAC: a viewer CANNOT read the field manifest (manager gate, 403)", async () => {
  // The manifest reveals backend schema detail (every field, incl. unmapped),
  // so it's manager+ — a plain viewer must be walled off.
  const res = await req("/api/fields/manifest", { headers: { cookie: VIEWER } });
  assert.equal(res.status, 403);
});

test("RBAC: an admin CAN read the field manifest", async () => {
  const res = await req("/api/fields/manifest", { headers: { cookie: ADMIN } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { reconciliation: { known: string[]; unknown: string[] }; customFields: unknown[] };
  assert.ok(body.reconciliation.known.length > 0);
  assert.ok(body.reconciliation.unknown.includes("customerTier"));
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

test("RBAC: a viewer CANNOT use the generic broker/command write edge (403)", async () => {
  // The command passthrough can invoke arbitrary backend actions incl. writes,
  // so it must enforce the same contributor gate as the REST write routes — a
  // viewer must not be able to forward a mutating action through it.
  const res = await req("/api/broker/command", {
    method: "POST",
    headers: { cookie: VIEWER, "content-type": "application/json" },
    body: JSON.stringify({ action: "delete_issue", payload: { projectId: "p", issueId: "i" } }),
  });
  assert.equal(res.status, 403);
});

test("broker/command: an admin is NOT blocked by the authorization gate", async () => {
  // Admin clears the contributor gate; in demo mode it then 502s (no live
  // broker), but it must NOT be the 403 authorization wall.
  const res = await req("/api/broker/command", {
    method: "POST",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ action: "list_projects", payload: {} }),
  });
  assert.notEqual(res.status, 403);
});

test("settings validation: invalid aiProvider is rejected (400), not persisted", async () => {
  const res = await req("/api/settings", {
    method: "PATCH",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ aiProvider: "totally-bogus" }),
  });
  assert.equal(res.status, 400);
});

test("SSRF guard: a link-local/metadata brokerUrl is rejected (400)", async () => {
  // 169.254.169.254 is the cloud metadata endpoint — never a legitimate broker.
  const res = await req("/api/settings", {
    method: "PATCH",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ brokerUrl: "http://169.254.169.254/latest/meta-data/" }),
  });
  assert.equal(res.status, 400);
});

test("SSRF guard: a non-http(s) brokerUrl scheme is rejected (400)", async () => {
  const res = await req("/api/settings", {
    method: "PATCH",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ brokerUrl: "file:///etc/passwd" }),
  });
  assert.equal(res.status, 400);
});

test("SSRF guard: the IPv4-mapped IPv6 form of the metadata address is rejected (400)", async () => {
  // http://[::ffff:169.254.169.254]/ normalises to ::ffff:a9fe:a9fe — must not bypass.
  const res = await req("/api/settings", {
    method: "PATCH",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ brokerUrl: "http://[::ffff:169.254.169.254]/latest/meta-data/" }),
  });
  assert.equal(res.status, 400);
});

test("SSRF guard: a legitimately-internal brokerUrl is accepted (not over-blocked)", async () => {
  // Self-hosted brokers are internal by design; an http(s) private host must pass.
  const res = await req("/api/settings", {
    method: "PATCH",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ brokerUrl: "http://n8n:5678/webhook/omni" }),
  });
  assert.equal(res.status, 200);
});

test("/fx-rates returns a rate table to an authenticated session", async () => {
  const res = await req("/api/fx-rates", { headers: { cookie: VIEWER } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { base?: string; rates?: Record<string, number> };
  assert.ok(body.base, "fx base present");
  assert.ok(body.rates && typeof body.rates === "object", "fx rates present");
});

test("logging sync: enabling without a warranty acknowledgement is rejected (400)", async () => {
  const res = await req("/api/settings", {
    method: "PATCH",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ loggingSync: { enabled: true, url: "https://logs.internal:9200/ingest", acknowledgedWarranty: false } }),
  });
  assert.equal(res.status, 400);
});

test("logging sync: enabling with a metadata URL is rejected (400, SSRF)", async () => {
  const res = await req("/api/settings", {
    method: "PATCH",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ loggingSync: { enabled: true, url: "http://169.254.169.254/ingest", acknowledgedWarranty: true } }),
  });
  assert.equal(res.status, 400);
});

test("logging sync: enabling with url + acknowledgement unlocks the timeTravel capability", async () => {
  // Off by default → time-travel locked.
  const before = (await (await req("/api/capabilities", { headers: { cookie: ADMIN } })).json()) as { timeTravel?: boolean };
  assert.equal(before.timeTravel, false);

  const enable = await req("/api/settings", {
    method: "PATCH",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ loggingSync: { enabled: true, url: "https://logs.internal:9200/ingest", acknowledgedWarranty: true } }),
  });
  assert.equal(enable.status, 200);

  const after = (await (await req("/api/capabilities", { headers: { cookie: ADMIN } })).json()) as { timeTravel?: boolean };
  assert.equal(after.timeTravel, true);

  // Restore (off) so global store state doesn't leak into other tests.
  await req("/api/settings", {
    method: "PATCH",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ loggingSync: { enabled: false, url: null, acknowledgedWarranty: false } }),
  });
});

test("time-travel replay is gated 409 until the logging sync is enabled, then 200", async () => {
  const locked = await req("/api/history/replay", { headers: { cookie: VIEWER } });
  assert.equal(locked.status, 409);

  await req("/api/settings", {
    method: "PATCH",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ loggingSync: { enabled: true, url: "https://logs.internal:9200/ingest", acknowledgedWarranty: true } }),
  });

  const open = await req("/api/history/replay", { headers: { cookie: VIEWER } });
  assert.equal(open.status, 200);
  assert.ok(Array.isArray(await open.json()), "replay returns an array of states");

  // Restore (off).
  await req("/api/settings", {
    method: "PATCH",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ loggingSync: { enabled: false, url: null, acknowledgedWarranty: false } }),
  });
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
