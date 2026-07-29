import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate, mulberry32, type RiskTask } from "./monte-carlo";

/**
 * Monte Carlo risk engine — stateless and fully deterministic given a seeded RNG (mulberry32).
 * Covers the S-curve invariants (ordered percentiles, monotone cumulative curve), the right-skew
 * insight (naive plan below the mean), the tornado ranking, the input-clamping bounds, and the
 * degenerate empty/zero-estimate case that must never divide by zero.
 */

const tasks: RiskTask[] = [
  { id: "a", label: "Foundations", estimate: 100 },
  { id: "b", label: "Walls", estimate: 40 },
  { id: "c", label: "Roof", estimate: 20 },
];

function run(opts: Partial<{ iterations: number; uncertainty: number; rng: () => number }> = {}) {
  return simulate(tasks, { iterations: 4000, uncertainty: 0.3, rng: mulberry32(42), ...opts });
}

test("returns ordered confidence levels within [min, max]", () => {
  const r = run();
  assert.ok(r.min <= r.p10);
  assert.ok(r.p10 <= r.p50);
  assert.ok(r.p50 <= r.p80);
  assert.ok(r.p80 <= r.p90);
  assert.ok(r.p90 <= r.max);
});

test("the naive plan is optimistic: deterministic sum sits below the mean (right-skew)", () => {
  const r = run();
  assert.equal(r.deterministic, 160); // 100+40+20
  assert.ok(r.mean > r.deterministic);
  // The naive plan is achieved well under half the time.
  assert.ok(r.planConfidence < 0.5);
});

test("ranks the biggest, most-uncertain task as the top variance driver (tornado)", () => {
  const r = run();
  assert.equal(r.sensitivity[0]!.id, "a"); // the 100-unit task dominates
  assert.ok(Math.abs(r.sensitivity[0]!.correlation) > Math.abs(r.sensitivity[2]!.correlation));
});

test("is deterministic for a given seed", () => {
  assert.equal(run().p90, run().p90);
  // Two fresh seeded streams with the same seed produce identical full results.
  assert.deepEqual(
    simulate(tasks, { iterations: 1000, uncertainty: 0.3, rng: mulberry32(7) }),
    simulate(tasks, { iterations: 1000, uncertainty: 0.3, rng: mulberry32(7) }),
  );
});

test("widens the spread as uncertainty rises", () => {
  const lo = run({ uncertainty: 0.1 });
  const hi = run({ uncertainty: 0.6 });
  assert.ok(hi.p90 - hi.p10 > lo.p90 - lo.p10);
});

test("produces a monotonic non-decreasing S-curve ending at probability 1", () => {
  const r = run();
  assert.ok(r.curve[0]!.probability >= 0);
  assert.equal(r.curve.at(-1)!.probability, 1);
  for (let i = 1; i < r.curve.length; i++) {
    assert.ok(r.curve[i]!.probability >= r.curve[i - 1]!.probability);
  }
});

test("drops non-positive tasks and keeps only the live ones", () => {
  const mixed: RiskTask[] = [
    { id: "a", label: "Real", estimate: 50 },
    { id: "z", label: "Zero", estimate: 0 },
    { id: "n", label: "Negative", estimate: -10 },
  ];
  const r = simulate(mixed, { iterations: 500, rng: mulberry32(3) });
  assert.equal(r.deterministic, 50); // only the live task counts
  assert.equal(r.sensitivity.length, 1); // dropped tasks never enter the tornado
  assert.equal(r.sensitivity[0]!.id, "a");
});

test("clamps iterations into [200, 20000]", () => {
  assert.equal(simulate(tasks, { iterations: 5, rng: mulberry32(1) }).iterations, 200);
  assert.equal(simulate(tasks, { iterations: 1_000_000, rng: mulberry32(1) }).iterations, 20000);
});

test("clamps uncertainty into [0.05, 1] — floor still produces a real spread, ceiling stays finite", () => {
  // uncertainty 0 is clamped up to 0.05, so the spread is small but non-degenerate.
  const floored = simulate(tasks, { iterations: 4000, uncertainty: 0, rng: mulberry32(9) });
  assert.ok(floored.p90 >= floored.p10);
  // uncertainty 5 is clamped down to 1; results must stay finite (no NaN/Infinity).
  const capped = simulate(tasks, { iterations: 4000, uncertainty: 5, rng: mulberry32(9) });
  assert.ok(Number.isFinite(capped.mean));
  assert.ok(Number.isFinite(capped.p90));
  // The floored spread is narrower than the capped one.
  assert.ok(capped.p90 - capped.p10 > floored.p90 - floored.p10);
});

test("handles an empty / zero-estimate task set without dividing by zero", () => {
  const r = simulate([{ id: "x", label: "x", estimate: 0 }], { rng: mulberry32(1) });
  assert.equal(r.deterministic, 0);
  assert.equal(r.p50, 0);
  assert.equal(r.planConfidence, 1);
  assert.deepEqual(r.sensitivity, []);
  assert.deepEqual(r.curve, []);
});
