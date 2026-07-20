import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * The resource-allocation + budget-plan stores (write side of resource management / financial planning) and
 * their artifact-agnostic ROWS endpoints — raw rows, or rolled up through the ONE generic `rollup` via a
 * ?groupBy/&metric spec. Same rows→rollup→render pattern as every other output; no bespoke aggregation.
 */
let h: Harness;
const ADMIN = adminCookie();
before(async () => { h = await startHarness(); });
after(() => h?.close());
afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ resourceAllocations: [], budgetPlans: [] });
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("resource allocations: store round-trips, and rows roll up generically", async () => {
  const allocs = [
    { id: "a1", resource: "ada@x", projectId: "p1", hours: 20, periodStart: "2026-01-01", periodEnd: "2026-03-31" },
    { id: "a2", resource: "ada@x", projectId: "p2", hours: 10, periodStart: "2026-01-01", periodEnd: "2026-03-31" },
    { id: "a3", resource: "bob@x", projectId: "p1", hours: 15, periodStart: "2026-01-01", periodEnd: "2026-03-31" },
  ];
  assert.equal((await h.req("/resource-allocations", { method: "PUT", cookie: ADMIN, body: { resourceAllocations: allocs } })).status, 200);

  const raw = await json(await h.req("/resource-allocations/rows", { cookie: ADMIN }));
  assert.equal(raw.rows.length, 3);

  // Generic roll-up: booked hours by resource — a JSON spec, not bespoke code.
  const byResource = await json(await h.req("/resource-allocations/rows?groupBy=resource&metric=sum:hours", { cookie: ADMIN }));
  const ada = byResource.rows.find((r: { resource: string }) => r.resource === "ada@x");
  assert.equal(ada.hours, 30);
  assert.equal(byResource.rows[0].resource, "ada@x"); // sorted by the metric desc
});

test("resource allocations: a malformed booking is rejected → 400", async () => {
  const bad = await h.req("/resource-allocations", { method: "PUT", cookie: ADMIN, body: { resourceAllocations: [{ id: "x", resource: "a", projectId: "p", hours: -5, periodStart: "2026-01-01", periodEnd: "2026-02-01" }] } });
  assert.equal(bad.status, 400);
  assert.match((await json(bad)).error, /hours/);
});

test("budget plans: store round-trips, and rows roll up by year generically", async () => {
  const plans = [
    { id: "b1", projectId: "p1", currency: "GBP", periods: [{ period: "2026-Q1", amount: 100 }, { period: "2026-Q2", amount: 150 }, { period: "2027-Q1", amount: 200 }] },
  ];
  assert.equal((await h.req("/budget-plans", { method: "PUT", cookie: ADMIN, body: { budgetPlans: plans } })).status, 200);

  const byYear = await json(await h.req("/budget-plans/rows?groupBy=year&metric=sum:amount", { cookie: ADMIN }));
  const y2026 = byYear.rows.find((r: { year: string }) => r.year === "2026");
  assert.equal(y2026.amount, 250); // Q1 + Q2
  const y2027 = byYear.rows.find((r: { year: string }) => r.year === "2027");
  assert.equal(y2027.amount, 200);
});

test("budget plans: a non-numeric period amount is rejected → 400", async () => {
  const bad = await h.req("/budget-plans", { method: "PUT", cookie: ADMIN, body: { budgetPlans: [{ id: "b", projectId: "p", periods: [{ period: "2026", amount: "lots" }] }] } });
  assert.equal(bad.status, 400);
  assert.match((await json(bad)).error, /amount/);
});
