// Real-auth mode (NOT demo) so data scope actually applies — in demo mode every session is all-scope.
// Set BEFORE importing the harness so the gateway boots with a real auth method configured.
process.env["OIDC_ISSUER_URL"] = "https://idp.scope.test";
process.env["OIDC_ADMIN_ROLES"] = "omni-admins";
process.env["OIDC_MANAGER_ROLES"] = "omni-managers";
process.env["OIDC_PROGRAMME_GROUP_PREFIX"] = "programme:";

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, cookie, type Harness } from "./_harness";

/**
 * Data-seam scoping for the resource-allocation + budget-plan stores. These carry per-project PII (a person
 * + their staffing) and financials, so a scoped caller must only READ their in-scope rows and may only WRITE
 * rows for in-scope projects. Exercised in real-auth mode (demo mode grants every session all-scope).
 */
let h: Harness;
// An admin needs hardware-bound MFA (amr) to actually wield the admin authority ⇒ all-scope.
const ADMIN = cookie({ sub: "admin-1", name: "A", email: "a@x.io", roles: ["omni-admins"], amr: ["hwk"] });
const MEMBER = cookie({ sub: "mem-1", name: "Mem", email: "mem@x.io", roles: ["omni-members"] }); // user-scope
const MGR_ALPHA = cookie({ sub: "mgr-1", name: "Mgr", email: "mgr@x.io", roles: ["omni-managers", "programme:alpha"] }); // programme scope

before(async () => { h = await startHarness(); });
after(() => h?.close());
afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ resourceAllocations: [], budgetPlans: [] });
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

const seed = async () => {
  await h.req("/resource-allocations", { method: "PUT", cookie: ADMIN, body: { resourceAllocations: [
    { id: "a1", resource: "ada@x", projectId: "p1", hours: 20, periodStart: "2026-01-01", periodEnd: "2026-03-31" },
  ] } });
  await h.req("/budget-plans", { method: "PUT", cookie: ADMIN, body: { budgetPlans: [
    { id: "b1", projectId: "p1", currency: "GBP", periods: [{ period: "2026-Q1", amount: 100 }] },
  ] } });
};

test("READ: all-scope admin sees the rows; a scoped (user/programme) caller does NOT (leak closed)", async () => {
  await seed();
  // Admin (all-scope): the filter is bypassed — full visibility.
  assert.equal((await json(await h.req("/resource-allocations/rows", { cookie: ADMIN }))).rows.length, 1);
  assert.equal((await json(await h.req("/budget-plans/rows", { cookie: ADMIN }))).rows.length, 1);
  // A user-scope member and a programme-scoped manager see NONE of p1's data (p1 is not in their scope).
  // Before the fix, any authenticated caller read every project's staffing PII + budgets.
  assert.deepEqual((await json(await h.req("/resource-allocations/rows", { cookie: MEMBER }))).rows, []);
  assert.deepEqual((await json(await h.req("/budget-plans/rows", { cookie: MEMBER }))).rows, []);
  assert.deepEqual((await json(await h.req("/resource-allocations/rows", { cookie: MGR_ALPHA }))).rows, []);
});

test("WRITE: a programme-scoped manager cannot create bookings/budgets for an out-of-scope project (403)", async () => {
  const alloc = await h.req("/resource-allocations", { method: "PUT", cookie: MGR_ALPHA, body: { resourceAllocations: [
    { id: "a1", resource: "ada@x", projectId: "p1", hours: 20, periodStart: "2026-01-01", periodEnd: "2026-03-31" },
  ] } });
  assert.equal(alloc.status, 403);
  assert.match((await json(alloc)).error, /outside your scope/);
  const budget = await h.req("/budget-plans", { method: "PUT", cookie: MGR_ALPHA, body: { budgetPlans: [
    { id: "b1", projectId: "p1", currency: "GBP", periods: [{ period: "2026-Q1", amount: 100 }] },
  ] } });
  assert.equal(budget.status, 403);
});

test("WRITE: a scoped manager's write cannot delete/overwrite another scope's existing rows", async () => {
  await seed(); // admin creates p1's allocation
  // The manager submits an EMPTY array (as if clearing "their" bookings). p1 is out of their scope, so it
  // must be preserved untouched — a scoped write may never wipe out-of-scope data.
  const r = await h.req("/resource-allocations", { method: "PUT", cookie: MGR_ALPHA, body: { resourceAllocations: [] } });
  assert.equal(r.status, 200);
  // p1's allocation is still there (visible to admin), not clobbered by the scoped manager's write.
  assert.equal((await json(await h.req("/resource-allocations/rows", { cookie: ADMIN }))).rows.length, 1);
});
