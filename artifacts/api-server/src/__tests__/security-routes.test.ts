import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, stepUpAdminCookie, type Harness } from "./_harness";

/**
 * Security / compliance admin plane over the REAL app. Admin-gated; the sensitive writes add a
 * step-up gate. Dual control is off in this harness (no DUAL_CONTROL_ACTIONS), so heldForDualControl
 * is always false and proposals only exist for the not-found approve/reject branches. Reachable
 * branches: the step-up gate, body/param validation (400), unknown key/proposal (404), and the
 * read + toggle success paths. Maintenance lockdown is released in afterEach so no write is left frozen.
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h.close());
afterEach(async () => {
  const { releaseMaintenance } = await import("../lib/maintenance");
  releaseMaintenance();
});

test("GET /security/keys without a cookie is 401", async () => {
  assert.equal((await h.req("/security/keys")).status, 401);
});

test("GET /security/keys lists the signing keys", async () => {
  const r = await h.req("/security/keys", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray((await r.json() as { keys: unknown[] }).keys));
});

test("POST /security/keys/:name/revoke without a fresh step-up is 403", async () => {
  const r = await h.req("/security/keys/session/revoke", { method: "POST", cookie: adminCookie() });
  assert.equal(r.status, 403);
  assert.equal((await r.json() as { code: string }).code, "step_up_required");
});

test("POST /security/keys/:name/revoke rejects an unknown key with 404", async () => {
  const r = await h.req("/security/keys/not-a-key/revoke", { method: "POST", cookie: stepUpAdminCookie(), body: {} });
  assert.equal(r.status, 404);
});

test("POST /security/sessions/revoke-user without a fresh step-up is 403 (Lane 2 gates: [requireStepUp])", async () => {
  const r = await h.req("/security/sessions/revoke-user", { method: "POST", cookie: adminCookie(), body: { sub: "u-x" } });
  assert.equal(r.status, 403);
  assert.equal((await r.json() as { code: string }).code, "step_up_required");
});

test("POST /security/audit/log/dispose without a fresh step-up is 403 (Lane 2 gates: [requireStepUp])", async () => {
  const r = await h.req("/security/audit/log/dispose", { method: "POST", cookie: adminCookie() });
  assert.equal(r.status, 403);
});

test("POST /security/sessions/revoke-user validates the body and revokes on a valid sub", async () => {
  const bad = await h.req("/security/sessions/revoke-user", { method: "POST", cookie: stepUpAdminCookie(), body: {} });
  assert.equal(bad.status, 400);
  const ok = await h.req("/security/sessions/revoke-user", { method: "POST", cookie: stepUpAdminCookie(), body: { sub: "u-revoke-target" } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json() as { ok: boolean }).ok, true);
});

test("GET /security/config-key returns the internal-key fingerprint", async () => {
  const r = await h.req("/security/config-key", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.equal(typeof (await r.json() as { fingerprint: string }).fingerprint, "string");
});

test("POST /security/config/export (admin + step-up) returns a bundle + ephemeral key", async () => {
  const r = await h.req("/security/config/export", { method: "POST", cookie: stepUpAdminCookie() });
  assert.equal(r.status, 200);
  const body = await r.json() as { bundle: unknown; exportKey: unknown };
  assert.ok(body.bundle && body.exportKey);
});

test("GET /admin/maintenance reports lockdown state", async () => {
  const r = await h.req("/admin/maintenance", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.equal(typeof (await r.json() as { engaged: boolean }).engaged, "boolean");
});

test("PUT /admin/maintenance without a fresh step-up is 403", async () => {
  const r = await h.req("/admin/maintenance", { method: "PUT", cookie: adminCookie(), body: { engaged: true } });
  assert.equal(r.status, 403);
});

test("PUT /admin/maintenance engages then releases the read-only lockdown", async () => {
  const on = await h.req("/admin/maintenance", { method: "PUT", cookie: stepUpAdminCookie(), body: { engaged: true, reason: "incident drill" } });
  assert.equal(on.status, 200);
  assert.equal((await on.json() as { engaged: boolean }).engaged, true);
  const off = await h.req("/admin/maintenance", { method: "PUT", cookie: stepUpAdminCookie(), body: { engaged: false } });
  assert.equal(off.status, 200);
  assert.equal((await off.json() as { engaged: boolean }).engaged, false);
});

test("GET /security/signing exposes the public verification key + status", async () => {
  assert.equal((await h.req("/security/signing", { cookie: adminCookie() })).status, 200);
});

test("GET /security/dsar requires a subject and returns a report when given one", async () => {
  const missing = await h.req("/security/dsar", { cookie: adminCookie() });
  assert.equal(missing.status, 400);
  const r = await h.req("/security/dsar?sub=u-123", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  const body = await r.json() as { report: unknown; summary: string };
  assert.ok(body.report && typeof body.summary === "string");
});

test("GET /security/data-residency returns the active policy + endpoint verdicts", async () => {
  assert.equal((await h.req("/security/data-residency", { cookie: adminCookie() })).status, 200);
});

test("POST /security/data-residency/validate without a fresh step-up is 403", async () => {
  const r = await h.req("/security/data-residency/validate", { method: "POST", cookie: adminCookie(), body: {} });
  assert.equal(r.status, 403);
});

test("POST /security/data-residency/validate accepts a valid policy and rejects a malformed one", async () => {
  const ok = await h.req("/security/data-residency/validate", { method: "POST", cookie: stepUpAdminCookie(), body: { regions: { eu: { backends: ["https://eu.broker/"], egress: ["*.eu.example"] } }, allowed: ["eu"] } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json() as { ok: boolean }).ok, true);
  const bad = await h.req("/security/data-residency/validate", { method: "POST", cookie: stepUpAdminCookie(), body: { regions: "not-an-object" } });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json() as { ok: boolean }).ok, false);
});

test("GET /security/audit/anchor returns the chain anchor", async () => {
  assert.equal((await h.req("/security/audit/anchor", { cookie: adminCookie() })).status, 200);
});

test("POST /security/audit/verify rejects a non-array body and verifies an empty slice", async () => {
  const bad = await h.req("/security/audit/verify", { method: "POST", cookie: adminCookie(), body: { events: "nope" } });
  assert.equal(bad.status, 400);
  const ok = await h.req("/security/audit/verify", { method: "POST", cookie: adminCookie(), body: { events: [] } });
  assert.equal(ok.status, 200);
});

test("GET /security/audit/log returns the evidence-log status", async () => {
  const r = await h.req("/security/audit/log", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  const body = await r.json() as { retained: number; durable: boolean; cap: number };
  assert.equal(typeof body.retained, "number");
  assert.equal(typeof body.durable, "boolean");
  assert.equal(typeof body.cap, "number");
});

test("POST /security/audit/log/dispose needs a fresh step-up, then reports disposed/remaining", async () => {
  assert.equal((await h.req("/security/audit/log/dispose", { method: "POST", cookie: adminCookie() })).status, 403);
  const r = await h.req("/security/audit/log/dispose", { method: "POST", cookie: stepUpAdminCookie() });
  assert.equal(r.status, 200);
  const body = await r.json() as { disposed: number; remaining: number };
  assert.equal(typeof body.disposed, "number");
  assert.equal(typeof body.remaining, "number");
});

test("GET /admin/approvals returns the (empty) proposal queue", async () => {
  const r = await h.req("/admin/approvals", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray((await r.json() as { proposals: unknown[] }).proposals));
});

test("approve/reject of an unknown proposal id are 404", async () => {
  const approve = await h.req("/admin/approvals/does-not-exist/approve", { method: "POST", cookie: stepUpAdminCookie() });
  assert.equal(approve.status, 404);
  const reject = await h.req("/admin/approvals/does-not-exist/reject", { method: "POST", cookie: stepUpAdminCookie() });
  assert.equal(reject.status, 404);
});
