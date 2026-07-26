import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCapacity, type CapacityInput } from "./capacity";

/**
 * Capacity-vs-demand grid: per resource × per period utilisation, over/under/idle classification, and
 * the resource/period/total roll-ups. Canonical 2×2 fixture with a known over-allocation, the
 * zero-capacity null guard, unmatched-demand surfacing, aggregate rollups, and empty-input degradation.
 */

// R1 is over-allocated in P1 (booked 120 vs cap 100); R2 is under everywhere.
const CANON: CapacityInput = {
  periods: ["P1", "P2"],
  resources: [
    { id: "r1", capacityPerPeriod: 100 },
    { id: "r2", capacityPerPeriod: 100 },
  ],
  demand: [
    { resourceId: "r1", period: "P1", effort: 80 },
    { resourceId: "r1", period: "P1", effort: 40 }, // two bookings sum to 120 → over by 20
    { resourceId: "r1", period: "P2", effort: 100 }, // exactly full
    { resourceId: "r2", period: "P1", effort: 30 }, // under
    // r2/P2 has no demand → idle
  ],
};

const cell = (r: ReturnType<typeof computeCapacity>, resourceId: string, period: string) =>
  r.grid.find((c) => c.resourceId === resourceId && c.period === period)!;

test("canonical grid: over-allocation, full, under, idle are classified correctly", () => {
  const r = computeCapacity(CANON);
  const r1p1 = cell(r, "r1", "P1");
  assert.equal(r1p1.booked, 120); // summed both bookings
  assert.equal(r1p1.over, 20);
  assert.equal(r1p1.slack, 0);
  assert.equal(r1p1.utilisation, 1.2); // 120/100
  assert.equal(r1p1.status, "over");

  assert.equal(cell(r, "r1", "P2").status, "full"); // exactly at capacity
  assert.equal(cell(r, "r2", "P1").status, "under"); // 30/100
  assert.equal(cell(r, "r2", "P1").slack, 70);
  assert.equal(cell(r, "r2", "P2").status, "idle"); // no booking
  assert.equal(cell(r, "r2", "P2").booked, 0);
});

test("per-resource rollup aggregates across periods", () => {
  const r = computeCapacity(CANON);
  const r1 = r.byResource.find((x) => x.resourceId === "r1")!;
  assert.equal(r1.capacity, 200); // 100 + 100
  assert.equal(r1.booked, 220); // 120 + 100
  assert.equal(r1.over, 20);
  assert.equal(r1.overPeriods, 1); // only P1
  assert.equal(r1.utilisation, 1.1); // 220/200
});

test("per-period rollup aggregates across resources and counts over-allocations", () => {
  const r = computeCapacity(CANON);
  const p1 = r.byPeriod.find((x) => x.period === "P1")!;
  assert.equal(p1.capacity, 200); // r1 100 + r2 100
  assert.equal(p1.booked, 150); // 120 + 30
  assert.equal(p1.over, 20); // only r1 contributes over
  assert.equal(p1.overResources, 1);
  assert.equal(p1.utilisation, 0.75); // 150/200
});

test("total rollup sums the whole grid", () => {
  const r = computeCapacity(CANON);
  assert.equal(r.total.capacity, 400);
  assert.equal(r.total.booked, 250); // 120+100+30+0
  assert.equal(r.total.over, 20);
  assert.equal(r.total.utilisation, 0.625); // 250/400
});

test("byPeriod preserves the caller's period order", () => {
  const r = computeCapacity({ ...CANON, periods: ["P2", "P1"] });
  assert.deepEqual(r.byPeriod.map((p) => p.period), ["P2", "P1"]);
});

test("byResource is sorted by id deterministically", () => {
  const r = computeCapacity({
    periods: ["P1"],
    resources: [
      { id: "zed", capacityPerPeriod: 10 },
      { id: "alpha", capacityPerPeriod: 10 },
    ],
    demand: [],
  });
  assert.deepEqual(r.byResource.map((x) => x.resourceId), ["alpha", "zed"]);
});

test("zero-capacity resource: utilisation is null (not Infinity), booking still counts as over", () => {
  const r = computeCapacity({
    periods: ["P1"],
    resources: [{ id: "r0", capacityPerPeriod: 0 }],
    demand: [{ resourceId: "r0", period: "P1", effort: 50 }],
  });
  const c = cell(r, "r0", "P1");
  assert.equal(c.utilisation, null);
  assert.equal(c.over, 50); // all of it is over-allocation
  assert.equal(c.status, "over");
  assert.equal(r.total.utilisation, null); // aggregate capacity 0 too
});

test("negative capacity and effort are clamped to 0", () => {
  const r = computeCapacity({
    periods: ["P1"],
    resources: [{ id: "r1", capacityPerPeriod: -100 }],
    demand: [{ resourceId: "r1", period: "P1", effort: -20 }],
  });
  const c = cell(r, "r1", "P1");
  assert.equal(c.capacity, 0);
  assert.equal(c.booked, 0);
  assert.equal(c.status, "idle");
});

test("demand for an unknown resource is surfaced in unmatchedDemand, not dropped or crashed", () => {
  const ghost = { resourceId: "ghost", period: "P1", effort: 99 };
  const r = computeCapacity({ ...CANON, demand: [...CANON.demand, ghost] });
  assert.equal(r.unmatchedDemand.length, 1);
  assert.deepEqual(r.unmatchedDemand[0], ghost);
  // The real grid is unaffected.
  assert.equal(cell(r, "r1", "P1").booked, 120);
});

test("demand for a period outside the requested window is ignored", () => {
  const r = computeCapacity({ ...CANON, demand: [{ resourceId: "r1", period: "P9", effort: 500 }] });
  assert.equal(r.grid.every((c) => c.period === "P1" || c.period === "P2"), true);
  assert.equal(r.total.booked, 0); // P9 booking dropped
  assert.equal(r.unmatchedDemand.length, 0); // resource matched; only the period was out of range
});

test("empty inputs degrade gracefully", () => {
  const r = computeCapacity({ periods: [], resources: [], demand: [] });
  assert.deepEqual(r.grid, []);
  assert.deepEqual(r.byResource, []);
  assert.deepEqual(r.byPeriod, []);
  assert.equal(r.total.utilisation, null); // 0 capacity
  assert.deepEqual(r.unmatchedDemand, []);
});
