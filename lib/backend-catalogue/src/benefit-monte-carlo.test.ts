import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateBenefit } from "./benefit-monte-carlo";
import { mulberry32 } from "./monte-carlo";

// A fixed seed makes every run below fully reproducible (no Math.random/Date).
const seeded = () => mulberry32(42);

test("deterministic given a seeded rng — identical inputs reproduce identical results", () => {
  const initiatives = [
    { id: "a", benefit: 1000, cost: 400 },
    { id: "b", benefit: 500, cost: 200 },
  ];
  const r1 = simulateBenefit(initiatives, { iterations: 500, rng: seeded() });
  const r2 = simulateBenefit(initiatives, { iterations: 500, rng: seeded() });
  assert.deepEqual(r1, r2);
});

test("deterministic net = Σ(benefit − cost); distribution brackets it", () => {
  const r = simulateBenefit(
    [
      { id: "a", benefit: 1000, cost: 400 },
      { id: "b", benefit: 500, cost: 200 },
    ],
    { iterations: 2000, rng: seeded() },
  );
  assert.equal(r.deterministic, 900); // (1000-400) + (500-200)
  assert.ok(r.min <= r.p50 && r.p50 <= r.max);
  assert.ok(r.p10 <= r.p50 && r.p50 <= r.p80 && r.p80 <= r.p90);
  assert.equal(r.valueAtRisk, r.p10); // VaR is the P10 downside
});

test("a comfortably profitable portfolio clears break-even with near-certainty", () => {
  const r = simulateBenefit([{ id: "a", benefit: 1000, cost: 100 }], { iterations: 2000, rng: seeded() });
  assert.ok(r.probabilityPositive > 0.99);
});

test("probabilityOfTarget falls as the target rises above the mean", () => {
  const initiatives = [{ id: "a", benefit: 1000, cost: 400 }];
  const low = simulateBenefit(initiatives, { iterations: 2000, target: 0, rng: seeded() });
  const high = simulateBenefit(initiatives, { iterations: 2000, target: 5000, rng: seeded() });
  assert.ok(low.probabilityOfTarget > high.probabilityOfTarget);
  assert.equal(high.probabilityOfTarget, 0); // unreachable target
  assert.ok(low.probabilityOfTarget >= 0 && low.probabilityOfTarget <= 1);
});

test("all probabilities are bounded in [0,1] and the S-curve is non-decreasing", () => {
  const r = simulateBenefit(
    [
      { id: "a", benefit: 800, cost: 300 },
      { id: "b", benefit: 200, cost: 500 }, // a value-destroying initiative
    ],
    { iterations: 1500, rng: seeded() },
  );
  for (const p of [r.probabilityPositive, r.probabilityOfTarget]) assert.ok(p >= 0 && p <= 1);
  for (let i = 1; i < r.curve.length; i++) assert.ok(r.curve[i]!.probability >= r.curve[i - 1]!.probability);
});

test("sensitivity ranks initiatives by |correlation|, deterministic id tiebreak", () => {
  const r = simulateBenefit(
    [
      { id: "small", benefit: 100, cost: 50 },
      { id: "big", benefit: 5000, cost: 1000 }, // dominates the variance
    ],
    { iterations: 2000, rng: seeded() },
  );
  assert.equal(r.sensitivity[0]!.id, "big");
  assert.equal(r.sensitivity.length, 2);
});

test("iterations and uncertainty are clamped to sane bounds", () => {
  const lo = simulateBenefit([{ id: "a", benefit: 100 }], { iterations: 1, uncertainty: 0, rng: seeded() });
  const hi = simulateBenefit([{ id: "a", benefit: 100 }], { iterations: 999999, uncertainty: 10, rng: seeded() });
  assert.equal(lo.iterations, 200); // floor
  assert.equal(hi.iterations, 20000); // ceiling
});

test("dirty / non-finite inputs are coerced, never NaN", () => {
  const r = simulateBenefit(
    [
      { id: "dirty", benefit: "1000" as unknown as number, cost: NaN as unknown as number },
      { id: "ok", benefit: 500, cost: 200 },
    ],
    { iterations: 500, rng: seeded() },
  );
  assert.equal(r.deterministic, 1300); // (1000 - 0) + (500 - 200)
  assert.equal(Number.isFinite(r.mean), true);
  assert.equal(Number.isNaN(r.p50), false);
});

test("empty portfolio ⇒ well-defined zero result (break-even certain)", () => {
  const r = simulateBenefit([], { iterations: 1000, target: 100, rng: seeded() });
  assert.equal(r.deterministic, 0);
  assert.equal(r.mean, 0);
  assert.equal(r.probabilityPositive, 1); // 0 >= 0
  assert.equal(r.probabilityOfTarget, 0); // 0 >= 100 is false
  assert.deepEqual(r.curve, []);
  assert.deepEqual(r.sensitivity, []);
});

test("empty portfolio with a non-positive target ⇒ target met with certainty", () => {
  const r = simulateBenefit([], { target: -50, rng: seeded() });
  assert.equal(r.probabilityOfTarget, 1); // 0 >= -50
});
