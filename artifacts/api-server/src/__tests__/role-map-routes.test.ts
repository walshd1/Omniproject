import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, stepUpAdminCookie, type Harness } from "./_harness";

/**
 * Role-map editor over the REAL app. Admin-gated + step-up on the writes. The demo
 * session holds every grant, so the reachable branches here are the step-up gate
 * (401 unauth / 403 stale / pass fresh) and the GET/PUT/rollback success paths.
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h.close());
afterEach(async () => {
  const { resetRoleMap } = await import("../lib/rbac");
  resetRoleMap();
  delete process.env["DUAL_CONTROL_ACTIONS"];
  delete process.env["SOD_POLICIES"];
  const { __resetDualControl } = await import("../lib/dual-control");
  await __resetDualControl();
});

const SOD_ADMIN_PMO = JSON.stringify([{ id: "sod-admin-pmo", label: "admin vs pmo", severity: "high", a: ["admin"], b: ["pmo"] }]);

test("GET /admin/role-map without a cookie is 401", async () => {
  const r = await h.req("/admin/role-map");
  assert.equal(r.status, 401);
});

test("GET /admin/role-map returns roles + mapping + rollback flag", async () => {
  const r = await h.req("/admin/role-map", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  const body = await r.json() as { roles: string[]; mapping: unknown[]; rollbackAvailable: boolean };
  assert.ok(Array.isArray(body.roles) && body.roles.includes("admin"));
  assert.ok(Array.isArray(body.mapping));
  assert.equal(body.rollbackAvailable, false);
});

test("PUT /admin/role-map without a fresh step-up is 403 step_up_required", async () => {
  const r = await h.req("/admin/role-map", { method: "PUT", cookie: adminCookie(), body: { admin: ["omni-admins"] } });
  assert.equal(r.status, 403);
  assert.equal((await r.json() as { code: string }).code, "step_up_required");
});

test("PUT /admin/role-map with a fresh step-up applies the override", async () => {
  const r = await h.req("/admin/role-map", { method: "PUT", cookie: stepUpAdminCookie(), body: { admin: ["corp-admins", "omni-admins"] } });
  assert.equal(r.status, 200);
  const body = await r.json() as { mapping: { role: string; claims: string[]; source: string }[] };
  const adminRow = body.mapping.find((m) => m.role === "admin")!;
  assert.equal(adminRow.source, "override");
  assert.ok(adminRow.claims.includes("corp-admins"));
});

test("POST /admin/role-map/rollback without a fresh step-up is 403", async () => {
  const r = await h.req("/admin/role-map/rollback", { method: "POST", cookie: adminCookie() });
  assert.equal(r.status, 403);
});

test("POST /admin/role-map/rollback undoes the last edit", async () => {
  // First an edit to fill the undo buffer, then roll it back.
  await h.req("/admin/role-map", { method: "PUT", cookie: stepUpAdminCookie(), body: { admin: ["temp-group"] } });
  const r = await h.req("/admin/role-map/rollback", { method: "POST", cookie: stepUpAdminCookie() });
  assert.equal(r.status, 200);
  assert.equal((await r.json() as { rolledBack: boolean }).rolledBack, true);
});

test("POST /admin/role-map/rollback with nothing to undo reports rolledBack:false", async () => {
  const r = await h.req("/admin/role-map/rollback", { method: "POST", cookie: stepUpAdminCookie() });
  assert.equal(r.status, 200);
  assert.equal((await r.json() as { rolledBack: boolean }).rolledBack, false);
});

test("SoD: mapping one IdP group into both sides of a policy (admin+pmo) is rejected 409", async () => {
  process.env["SOD_POLICIES"] = SOD_ADMIN_PMO;
  const r = await h.req("/admin/role-map", { method: "PUT", cookie: stepUpAdminCookie(), body: { admin: ["ops"], pmo: ["ops"] } });
  assert.equal(r.status, 409);
  const body = await r.json() as { error: string; conflicts: { subjectId: string; policyId: string }[] };
  assert.match(body.error, /separation-of-duties/i);
  assert.ok(body.conflicts.some((c) => c.subjectId === "ops" && c.policyId === "sod-admin-pmo"));
  // The conflicting edit did NOT take effect.
  const get = await h.req("/admin/role-map", { cookie: adminCookie() });
  const mapping = (await get.json() as { mapping: { role: string; source: string }[] }).mapping;
  assert.notEqual(mapping.find((m) => m.role === "admin")?.source, "override");
});

test("SoD: a non-conflicting mapping still applies when a policy is configured", async () => {
  process.env["SOD_POLICIES"] = SOD_ADMIN_PMO;
  // admin and pmo overridden to DISJOINT groups → no single group holds both authorities.
  const r = await h.req("/admin/role-map", { method: "PUT", cookie: stepUpAdminCookie(), body: { admin: ["ops"], pmo: ["planners"] } });
  assert.equal(r.status, 200);
  const adminRow = (await r.json() as { mapping: { role: string; claims: string[]; source: string }[] }).mapping.find((m) => m.role === "admin")!;
  assert.equal(adminRow.source, "override");
  assert.ok(adminRow.claims.includes("ops"));
});

test("SoD: with no SOD_POLICIES the control is inert (the same both-sides edit applies)", async () => {
  // No SOD_POLICIES set (afterEach clears it) → the engine detects nothing at request time.
  const r = await h.req("/admin/role-map", { method: "PUT", cookie: stepUpAdminCookie(), body: { admin: ["ops"], pmo: ["ops"] } });
  assert.equal(r.status, 200);
});

test("SoD: a malformed SOD_POLICIES fails closed (500, edit refused)", async () => {
  process.env["SOD_POLICIES"] = "{ not valid json";
  const r = await h.req("/admin/role-map", { method: "PUT", cookie: stepUpAdminCookie(), body: { admin: ["ops"] } });
  assert.equal(r.status, 500);
  assert.match((await r.json() as { error: string }).error, /misconfigured/i);
});

test("four-eyes: mapping admin authority is HELD for a second approver when dual control is on", async () => {
  process.env["DUAL_CONTROL_ACTIONS"] = "role_map.update";
  const r = await h.req("/admin/role-map", { method: "PUT", cookie: stepUpAdminCookie(), body: { admin: ["attacker-group"] } });
  assert.equal(r.status, 202); // held as a proposal, not applied
  const body = await r.json() as { pending: boolean; proposalId: string };
  assert.equal(body.pending, true);
  assert.ok(body.proposalId);
  // The mapping did NOT take effect — the elevation is pending a second admin.
  const get = await h.req("/admin/role-map", { cookie: adminCookie() });
  const mapping = (await get.json() as { mapping: { role: string; source: string }[] }).mapping;
  assert.notEqual(mapping.find((m) => m.role === "admin")?.source, "override");
});
