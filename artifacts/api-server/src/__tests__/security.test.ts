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
process.env["OIDC_PMO_ROLES"] = "omni-pmo";
process.env["OIDC_MANAGER_ROLES"] = "omni-managers";
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
const MANAGER = signedSessionCookie({ sub: "manager-1", roles: ["omni-managers"] });
const PMO = signedSessionCookie({ sub: "pmo-1", roles: ["omni-pmo"] });
// Freshly stepped-up admin (some sensitive routes — raw escape hatch, governance,
// key revocation — require a recent re-auth on top of the admin role).
const ADMIN = signedSessionCookie({ sub: "admin-1", roles: ["omni-admins"], stepUpAt: Date.now() });
// An admin WITHOUT a recent step-up — for asserting the step-up wall.
const ADMIN_NO_STEPUP = signedSessionCookie({ sub: "admin-2", roles: ["omni-admins"] });
// Holds BOTH authorities — the join (governance + technical).
const PMO_ADMIN = signedSessionCookie({ sub: "both-1", roles: ["omni-pmo", "omni-admins"], stepUpAt: Date.now() });

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

test("an idle-expired session is rejected (401) — sliding timeout enforced", async () => {
  // Last activity an hour ago — past the 30m default idle limit.
  const idle = signedSessionCookie({ sub: "stale-1", roles: [], seen: Date.now() - 60 * 60_000 });
  const res = await req("/api/projects", { headers: { cookie: idle } });
  assert.equal(res.status, 401);
});

test("a session past its absolute lifetime is rejected (401)", async () => {
  const old = signedSessionCookie({ sub: "old-1", roles: [], iat: Date.now() - 9 * 60 * 60_000, seen: Date.now() });
  const res = await req("/api/projects", { headers: { cookie: old } });
  assert.equal(res.status, 401);
});

test("responses carry the timing headers (upstream vs total)", async () => {
  const res = await req("/api/projects", { headers: { cookie: VIEWER } });
  // Present on every response; demo broker has no upstream hop so it reads 0.
  assert.match(res.headers.get("x-omni-upstream-ms") ?? "", /^\d+$/);
  assert.match(res.headers.get("x-omni-total-ms") ?? "", /^\d+$/);
  // Standard Server-Timing carries the same split for the browser Performance API.
  assert.match(res.headers.get("server-timing") ?? "", /upstream;dur=\d+.*gateway;dur=\d+.*total;dur=\d+/);
});

test("an oversized request body is rejected (hard buffer limit, 413)", async () => {
  // ~600kb payload exceeds the 256kb default body limit.
  const huge = "x".repeat(600 * 1024);
  const res = await req("/api/projects/proj-1/issues", {
    method: "POST",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ title: huge }),
  });
  assert.equal(res.status, 413);
});

test("the broker contract is public and reports a version + JSON Schema", async () => {
  const res = await req("/api/contract"); // no cookie — public
  assert.equal(res.status, 200);
  const body = (await res.json()) as { version: string; schema: { $defs?: Record<string, unknown> } };
  assert.equal(body.version, "v1");
  assert.ok(body.schema && body.schema.$defs && Object.keys(body.schema.$defs).length > 0, "schema has $defs");
});

test("the broker-agnostic consumer API spec is public (OpenAPI YAML + discovery)", async () => {
  // Both are documentation, served before auth — no cookie.
  const spec = await req("/api/openapi.yaml");
  assert.equal(spec.status, 200);
  assert.match(spec.headers.get("content-type") ?? "", /yaml/);
  const text = await spec.text();
  assert.match(text, /^openapi: 3/);
  assert.match(text, /broker-agnostic/i, "the spec frames itself as broker-agnostic");

  const disc = await req("/api/discovery");
  assert.equal(disc.status, 200);
  const body = (await disc.json()) as { brokerAgnostic: boolean; openapi: { url: string }; brokerContract: string; paths: string[] };
  assert.equal(body.brokerAgnostic, true);
  assert.match(body.openapi.url, /\/api\/openapi\.yaml$/);
  assert.match(body.brokerContract, /\/api\/contract$/); // links to the southbound contract
  assert.ok(Array.isArray(body.paths) && body.paths.includes("/projects"));
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

test("RBAC: a viewer CANNOT read the admin broker-log (admin gate, 403)", async () => {
  const res = await req("/api/admin/broker-log", { headers: { cookie: VIEWER } });
  assert.equal(res.status, 403);
});

test("RBAC: an admin CAN read the broker-log", async () => {
  const res = await req("/api/admin/broker-log", { headers: { cookie: ADMIN } });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(await res.json()));
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

// ── PMO tier: business governance (ruleset) is PMO+, technical config stays admin ──
test("RBAC: a manager CANNOT read the business ruleset (PMO gate, 403)", async () => {
  // The ruleset is programme/business governance — PMO domain, above plain manager.
  const res = await req("/api/admin/ruleset", { headers: { cookie: MANAGER } });
  assert.equal(res.status, 403);
});

test("RBAC: a PMO CAN read AND set the business ruleset", async () => {
  const get = await req("/api/admin/ruleset", { headers: { cookie: PMO } });
  assert.equal(get.status, 200);
  const put = await req("/api/admin/ruleset", {
    method: "PUT",
    headers: { cookie: PMO, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(put.status, 200);
});

test("RBAC: a PURE admin CANNOT read the business ruleset (governance is orthogonal)", async () => {
  // The decisive change: admin is the TECHNICAL authority, not a superset of PMO.
  // A pure admin holds no governance grant, so the business ruleset is closed to it.
  const res = await req("/api/admin/ruleset", { headers: { cookie: ADMIN } });
  assert.equal(res.status, 403);
});

test("RBAC: holding BOTH pmo+admin (the join) clears governance AND technical gates", async () => {
  // Business governance (pmo) …
  assert.equal((await req("/api/admin/ruleset", { headers: { cookie: PMO_ADMIN } })).status, 200);
  // … and technical config (admin) — the union.
  assert.equal((await req("/api/admin/broker-log", { headers: { cookie: PMO_ADMIN } })).status, 200);
});

test("RBAC: a PMO can list AND apply a methodology reference ruleset", async () => {
  const list = await req("/api/admin/ruleset/reference", { headers: { cookie: PMO } });
  assert.equal(list.status, 200);
  const bundles = (await list.json()) as { methodology: string }[];
  assert.ok(bundles.some((b) => b.methodology === "scrum"));
  // Apply Scrum (warns + schedule-sanity hard — no hard field rule, so it can't
  // wedge the other tests' create paths).
  const apply = await req("/api/admin/ruleset/apply-reference", {
    method: "POST",
    headers: { cookie: PMO, "content-type": "application/json" },
    body: JSON.stringify({ methodology: "scrum" }),
  });
  assert.equal(apply.status, 200);
  const after = (await apply.json()) as { rules: { id: string; mode: string }[] };
  assert.equal(after.rules.find((r) => r.id === "due-after-start")?.mode, "hard");
});

test("RBAC: neither a manager NOR a pure admin can apply a reference ruleset (PMO gate)", async () => {
  for (const cookie of [MANAGER, ADMIN]) {
    const res = await req("/api/admin/ruleset/apply-reference", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ methodology: "scrum" }),
    });
    assert.equal(res.status, 403);
  }
});

test("RBAC: a PMO CANNOT read the technical broker-log (still admin-only)", async () => {
  // The PMO owns business rules, not technical config — the security boundary holds.
  const res = await req("/api/admin/broker-log", { headers: { cookie: PMO } });
  assert.equal(res.status, 403);
});

test("role-map editor is admin-only (PMO is business, not technical)", async () => {
  // PMO is blocked — managing IdP-group → role mapping is technical config.
  assert.equal((await req("/api/admin/role-map", { headers: { cookie: PMO } })).status, 403);
  // Admin can read the mapping…
  const get = await req("/api/admin/role-map", { headers: { cookie: ADMIN } });
  assert.equal(get.status, 200);
  const body = (await get.json()) as { roles: string[]; mapping: { role: string }[] };
  assert.ok(body.roles.includes("pmo") && body.mapping.some((m) => m.role === "pmo"));
  // …and set an override (only known roles are accepted).
  const put = await req("/api/admin/role-map", {
    method: "PUT",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ pmo: ["programme-managers"], wizard: ["nope"] }),
  });
  assert.equal(put.status, 200);
  const after = (await put.json()) as { mapping: { role: string; claims: string[]; source: string }[] };
  assert.equal(after.mapping.some((m) => m.role === "wizard"), false, "cannot invent a role");
  assert.deepEqual(after.mapping.find((m) => m.role === "pmo")?.claims, ["programme-managers"]);
  // Restore the PMO group so later PMO-session tests still resolve (overrides are
  // module-global and REPLACE env).
  await req("/api/admin/role-map", {
    method: "PUT",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ pmo: ["omni-pmo"] }),
  });
});

test("raw API escape hatch: admin-only, off by default, and still bolted to the broker seam", async () => {
  const callRaw = (cookie: string) => req("/api/admin/raw", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "anything", payload: {} }),
  });
  // Non-admins (incl. PMO — it's technical, not business) are walled off at RBAC.
  assert.equal((await callRaw(VIEWER)).status, 403);
  assert.equal((await callRaw(PMO)).status, 403);
  // An admin WITHOUT a recent step-up is refused with the step-up signal — holding the
  // role isn't enough for this escape hatch; a fresh re-auth is required.
  const stale = await callRaw(ADMIN_NO_STEPUP);
  assert.equal(stale.status, 403);
  assert.equal(((await stale.json()) as { code?: string }).code, "step_up_required");
  // Admin clears RBAC, but the hatch is bolted shut unless RAW_API_ENABLED is set.
  const off = await callRaw(ADMIN);
  assert.equal(off.status, 503);
  assert.match(String(((await off.json()) as { error?: string }).error ?? ""), /RAW_API_ENABLED|disabled/i);
  // Opting in gets past the env gate — but it STILL requires a configured broker
  // (it can't be turned into an SSRF/relay): no broker here ⇒ not the 503 anymore.
  process.env["RAW_API_ENABLED"] = "1";
  try {
    const on = await callRaw(ADMIN);
    assert.notEqual(on.status, 503, "the env gate opened");
    assert.notEqual(on.status, 403);
  } finally {
    delete process.env["RAW_API_ENABLED"];
  }
});

test("RBAC: a PMO CANNOT change technical settings (still admin-only)", async () => {
  const res = await req("/api/settings", {
    method: "PATCH",
    headers: { cookie: PMO, "content-type": "application/json" },
    body: JSON.stringify({ brokerUrl: "http://evil.example" }),
  });
  assert.equal(res.status, 403);
});

test("admin-only backends (raw SQL / Mongo) are hidden from non-admins in the wizard", async () => {
  const forViewer = (await (await req("/api/setup/backends", { headers: { cookie: VIEWER } })).json()) as { id: string; adminOnly: boolean }[];
  assert.equal(forViewer.some((b) => b.id === "sql" || b.id === "mongodb"), false, "non-admin must not be offered DB backends");
  assert.ok(forViewer.some((b) => b.id === "excel"), "but the Excel import source is fine for anyone");

  const forAdmin = (await (await req("/api/setup/backends", { headers: { cookie: ADMIN } })).json()) as { id: string; adminOnly: boolean }[];
  const sql = forAdmin.find((b) => b.id === "sql");
  assert.ok(sql?.adminOnly, "admin sees the SQL backend, flagged admin-only");
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
  // Admin clears the contributor gate; with no broker configured (no BROKER_URL
  // env and no admin-set settings.brokerUrl) it then refuses with the demo-mode
  // 502, but it must NOT be the 403 authorization wall.
  const res = await req("/api/broker/command", {
    method: "POST",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ action: "list_projects", payload: {} }),
  });
  assert.notEqual(res.status, 403);
  // The passthrough stays CLOSED when nothing is wired: true demo must refuse, so
  // the edge can't become an open relay. (It opens only once a broker is
  // configured — via BROKER_URL or an admin-set settings.brokerUrl.)
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error?: string };
  assert.match(String(body.error ?? ""), /demo mode|No backend configured/i);
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
