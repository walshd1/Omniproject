import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateReassignment } from "./reassignment";
import type { CapacityInput } from "./capacity";

// Baseline: one period, A over-allocated (150/100), B with slack (20/100).
const base: CapacityInput = {
  periods: ["2026-01"],
  resources: [
    { id: "A", capacityPerPeriod: 100 },
    { id: "B", capacityPerPeriod: 100 },
  ],
  demand: [
    { resourceId: "A", period: "2026-01", effort: 150 },
    { resourceId: "B", period: "2026-01", effort: 20 },
  ],
};

test("a well-sized move relieves over-allocation and reports improvement", () => {
  const r = simulateReassignment(base, [
    { id: "m1", fromResourceId: "A", toResourceId: "B", period: "2026-01", effort: 50 },
  ]);
  assert.equal(r.total.baselineOver, 50);
  assert.equal(r.total.proposedOver, 0);
  assert.equal(r.total.overDelta, -50);
  assert.equal(r.improved, true);
  // Reassignment moves effort between resources — total booked (and total utilisation) is unchanged.
  assert.equal(r.total.baselineUtilisation, 0.85);
  assert.equal(r.total.proposedUtilisation, 0.85);
  const a = r.byResource.find((x) => x.resourceId === "A")!;
  assert.equal(a.baselineOver, 50);
  assert.equal(a.proposedOver, 0);
  assert.equal(a.overDelta, -50);
  assert.equal(a.baselineUtilisation, 1.5);
  assert.equal(a.proposedUtilisation, 1);
  assert.equal(r.rejectedMoves.length, 0);
});

test("over-reassigning past the source's booked effort is clamped and flagged", () => {
  const r = simulateReassignment(base, [
    { id: "m1", fromResourceId: "A", toResourceId: "B", period: "2026-01", effort: 200 },
  ]);
  // A only had 150 booked, so only 150 shifts; B is now over (170/100).
  assert.equal(r.rejectedMoves.length, 1);
  assert.equal(r.rejectedMoves[0]!.reason, "insufficient-effort");
  assert.equal(r.rejectedMoves[0]!.applied, 150);
  assert.equal(r.total.proposedOver, 70);
  assert.equal(r.improved, false); // making B over is worse than the baseline
});

test("empty moves ⇒ baseline unchanged, no improvement", () => {
  const r = simulateReassignment(base, []);
  assert.equal(r.total.overDelta, 0);
  assert.equal(r.improved, false);
  for (const d of r.byResource) assert.equal(d.overDelta, 0);
  assert.equal(r.rejectedMoves.length, 0);
});

test("moves naming an unknown resource or period are rejected, not applied", () => {
  const r = simulateReassignment(base, [
    { id: "bad-from", fromResourceId: "Z", toResourceId: "B", period: "2026-01", effort: 10 },
    { id: "bad-to", fromResourceId: "A", toResourceId: "Z", period: "2026-01", effort: 10 },
    { id: "bad-period", fromResourceId: "A", toResourceId: "B", period: "1999-01", effort: 10 },
    { id: "self", fromResourceId: "A", toResourceId: "A", period: "2026-01", effort: 10 },
  ]);
  assert.deepEqual(
    r.rejectedMoves.map((m) => [m.id, m.reason]),
    [["bad-from", "unknown-from-resource"], ["bad-to", "unknown-to-resource"], ["bad-period", "unknown-period"], ["self", "same-resource"]],
  );
  assert.equal(r.total.overDelta, 0); // nothing applied
});

test("proposedDemand reflects the shift and is deterministically ordered", () => {
  const r = simulateReassignment(base, [
    { id: "m1", fromResourceId: "A", toResourceId: "B", period: "2026-01", effort: 50 },
  ]);
  assert.deepEqual(r.proposedDemand, [
    { resourceId: "A", period: "2026-01", effort: 100 },
    { resourceId: "B", period: "2026-01", effort: 70 },
  ]);
});

test("dirty / non-finite effort is coerced, never NaN", () => {
  const r = simulateReassignment(base, [
    { id: "m1", fromResourceId: "A", toResourceId: "B", period: "2026-01", effort: "50" as unknown as number },
  ]);
  assert.equal(r.total.proposedOver, 0);
  assert.equal(Number.isNaN(r.total.overDelta), false);
});

test("utilisation stays guarded (null) for a zero-capacity resource", () => {
  const withIdle: CapacityInput = {
    periods: ["2026-01"],
    resources: [
      { id: "A", capacityPerPeriod: 100 },
      { id: "Z", capacityPerPeriod: 0 }, // unavailable
    ],
    demand: [{ resourceId: "A", period: "2026-01", effort: 50 }],
  };
  const r = simulateReassignment(withIdle, [
    { id: "m1", fromResourceId: "A", toResourceId: "Z", period: "2026-01", effort: 30 },
  ]);
  const z = r.byResource.find((x) => x.resourceId === "Z")!;
  assert.equal(z.baselineUtilisation, null); // 0 capacity ⇒ null, never NaN/Infinity
  assert.equal(z.proposedUtilisation, null);
  assert.equal(z.proposedOver, 30); // all the shifted effort is over-allocation on the idle resource
});

test("byResource is emitted sorted by id (determinism)", () => {
  const shuffled: CapacityInput = {
    periods: ["p"],
    resources: [
      { id: "c", capacityPerPeriod: 10 },
      { id: "a", capacityPerPeriod: 10 },
      { id: "b", capacityPerPeriod: 10 },
    ],
    demand: [],
  };
  const r = simulateReassignment(shuffled, []);
  assert.deepEqual(r.byResource.map((x) => x.resourceId), ["a", "b", "c"]);
});
