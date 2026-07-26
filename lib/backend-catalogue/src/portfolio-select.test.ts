import { test } from "node:test";
import assert from "node:assert/strict";
import { selectByRatio, selectOptimal, EXACT_MAX_BUDGET } from "./portfolio-select";

/**
 * Portfolio selection / efficient frontier — the 0/1 knapsack pick under a budget (+ optional capacity) cap.
 * The greedy value/cost heuristic vs the exact DP (proven to diverge on the classic counterexample), budget
 * fit + zero budget, the capacity cap binding independently of budget, deterministic id tiebreak, dirty-input
 * coercion, and the DP-bound fallback that flags exact:false. Mirrors funding.ts's discipline.
 */

// The classic knapsack counterexample (budget 50): greedy grabs the highest-ratio item and is left short;
// the optimum skips it. a=(v60,c10,r6) b=(v100,c20,r5) c=(v120,c30,r4).
const CLASSIC = [
  { id: "a", value: 60, cost: 10 },
  { id: "b", value: 100, cost: 20 },
  { id: "c", value: 120, cost: 30 },
];

test("greedy is a heuristic — takes the highest ratio first and can be sub-optimal", () => {
  const r = selectByRatio(CLASSIC, 50);
  assert.deepEqual(r.selected, ["a", "b"]); // ratios 6 then 5; c (30) no longer fits the remaining 20
  assert.equal(r.totalValue, 160);
  assert.equal(r.totalCost, 30);
  assert.equal(r.budgetUsedPct, 0.6); // 30/50
  assert.equal(r.exact, false);
});

test("exact DP beats greedy on the same instance and is flagged exact", () => {
  const r = selectOptimal(CLASSIC, 50);
  assert.deepEqual(r.selected, ["b", "c"]); // 100+120 = 220 at cost 50 — the true optimum
  assert.equal(r.totalValue, 220);
  assert.equal(r.totalCost, 50);
  assert.equal(r.budgetUsedPct, 1); // fills the budget exactly
  assert.equal(r.exact, true);
  assert.ok(r.totalValue > selectByRatio(CLASSIC, 50).totalValue, "exact ≥ greedy in value");
});

test("zero budget selects nothing (no divide by zero — budgetUsedPct null)", () => {
  const r = selectOptimal(CLASSIC, 0);
  assert.deepEqual(r.selected, []);
  assert.deepEqual(r.dropped, ["a", "b", "c"]);
  assert.equal(r.totalValue, 0);
  assert.equal(r.totalCost, 0);
  assert.equal(r.budgetUsedPct, null);
  assert.equal(r.exact, true);
});

test("a zero-cost positive-value item is always taken (infinite bang-per-buck)", () => {
  const r = selectByRatio([{ id: "free", value: 5, cost: 0 }, { id: "x", value: 10, cost: 100 }], 10);
  assert.ok(r.selected.includes("free"));
  assert.ok(!r.selected.includes("x")); // 100 > budget 10
});

test("the capacity cap binds independently of the budget", () => {
  const cands = [
    { id: "x", value: 10, cost: 1, capacity: 5 },
    { id: "y", value: 9, cost: 1, capacity: 5 },
  ];
  const r = selectByRatio(cands, 100, { capacity: 6 }); // budget is generous; capacity 6 admits only one
  assert.deepEqual(r.selected, ["x"]); // higher ratio first, y's 5 capacity won't fit the remaining 1
  assert.equal(r.totalCapacity, 5);
  assert.equal(r.totalCost, 1);
});

test("selection is deterministic — ties broken by id ascending, stable across runs", () => {
  const tied = [
    { id: "b", value: 10, cost: 5 },
    { id: "a", value: 10, cost: 5 }, // identical ratio; only one fits budget 5
  ];
  const r1 = selectByRatio(tied, 5);
  const r2 = selectByRatio(tied, 5);
  assert.deepEqual(r1.selected, ["a"]); // lower id wins the tie
  assert.deepEqual(r1, r2); // same input → identical result
});

test("dirty inputs are coerced (non-finite value ⇒ 0 ⇒ never selected; non-finite cost ⇒ 0)", () => {
  const r = selectByRatio([
    { id: "bad", value: NaN, cost: 5 },
    { id: "good", value: 20, cost: 5 },
  ], 5);
  assert.deepEqual(r.selected, ["good"]);
  assert.deepEqual(r.dropped, ["bad"]);
  assert.equal(r.totalValue, 20);
});

test("exact solver falls back to the greedy heuristic (exact:false) outside its bounded regime", () => {
  // Non-integer budget → not eligible for the integer DP.
  assert.equal(selectOptimal(CLASSIC, 50.5).exact, false);
  // A capacity cap needs a 2-D table → out of the 1-D exact scope.
  assert.equal(selectOptimal(CLASSIC, 50, { capacity: 100 }).exact, false);
  // A budget beyond the table bound → fall back rather than allocate an unbounded table.
  assert.equal(selectOptimal(CLASSIC, EXACT_MAX_BUDGET + 1).exact, false);
  // Non-integer cost → not eligible.
  assert.equal(selectOptimal([{ id: "a", value: 10, cost: 2.5 }], 10).exact, false);
});
