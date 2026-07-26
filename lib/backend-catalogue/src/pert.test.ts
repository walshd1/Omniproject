import { test } from "node:test";
import assert from "node:assert/strict";
import { computePertEstimate, rollupPert, pertInterval } from "./pert";

/**
 * PERT three-point estimating: beta-distribution mean (o + 4m + p)/6, standard deviation (p − o)/6, and
 * the additive variance. Canonical vector, the validity gate (non-finite and mis-ordered points yield
 * valid:false with null stats — never a throw or a poisoned number), the variance-summing roll-up whose
 * stdDev is sqrt(Σ variances) and NOT the sum of the task stdDevs, the empty/all-invalid roll-up that
 * must yield count 0 and nulls, and the confidence-band helper.
 */

// Canonical: o=2, m=4, p=6 ⇒ mean 4, stdDev (6−2)/6 = 0.6667, variance 0.6667² = 0.4444.
test("canonical vector: mean 4, stdDev 0.6667, variance 0.4444", () => {
  const r = computePertEstimate({ optimistic: 2, mostLikely: 4, pessimistic: 6 });
  assert.equal(r.valid, true);
  assert.equal(r.mean, 4); // (2 + 16 + 6) / 6
  assert.equal(r.stdDev, 0.6667); // (6 − 2) / 6, rounded to 4 dp
  assert.equal(r.variance, 0.4444); // (4/6)² = 16/36, rounded to 4 dp
});

// Skewed toward the pessimistic tail: the 4× weight on the mode keeps the mean below the midpoint.
test("skewed estimate: mode weighting pulls the mean off the range midpoint", () => {
  const r = computePertEstimate({ optimistic: 10, mostLikely: 12, pessimistic: 26 });
  assert.equal(r.mean, 14); // (10 + 48 + 26) / 6 = 84/6, below the 18 midpoint
  assert.equal(r.stdDev, 2.6667); // (26 − 10) / 6
  assert.equal(r.variance, 7.1111); // (16/6)² = 256/36
});

test("degenerate estimate (o = m = p) ⇒ zero spread, mean equals the point", () => {
  const r = computePertEstimate({ optimistic: 5, mostLikely: 5, pessimistic: 5 });
  assert.equal(r.valid, true);
  assert.equal(r.mean, 5);
  assert.equal(r.stdDev, 0);
  assert.equal(r.variance, 0);
});

test("mis-ordered points (o > m or m > p) ⇒ valid:false, null stats, no throw", () => {
  const a = computePertEstimate({ optimistic: 6, mostLikely: 4, pessimistic: 2 });
  assert.equal(a.valid, false);
  assert.equal(a.mean, null);
  assert.equal(a.stdDev, null);
  assert.equal(a.variance, null);
  // m above p is equally invalid.
  const b = computePertEstimate({ optimistic: 1, mostLikely: 9, pessimistic: 5 });
  assert.equal(b.valid, false);
  assert.equal(b.mean, null);
});

test("non-finite point ⇒ valid:false, null stats", () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    const r = computePertEstimate({ optimistic: 1, mostLikely: bad, pessimistic: 5 });
    assert.equal(r.valid, false);
    assert.equal(r.mean, null);
    assert.equal(r.variance, null);
  }
});

test("roll-up: means add, variances add, chain stdDev is sqrt(Σ variances)", () => {
  // Two identical [2,4,6] tasks: mean 4+4=8, variance 0.4444+0.4444, stdDev = sqrt(0.8889).
  const r = rollupPert([
    { optimistic: 2, mostLikely: 4, pessimistic: 6 },
    { optimistic: 2, mostLikely: 4, pessimistic: 6 },
  ]);
  assert.equal(r.count, 2);
  assert.equal(r.mean, 8);
  assert.equal(r.variance, 0.8889); // 2 × 16/36 = 32/36, from raw (not 2 × rounded 0.4444)
  assert.equal(r.stdDev, 0.9428); // sqrt(32/36) — NOT 0.6667 + 0.6667 = 1.3334
});

test("roll-up skips invalid estimates and counts only what it used", () => {
  const r = rollupPert([
    { optimistic: 2, mostLikely: 4, pessimistic: 6 }, // valid
    { optimistic: 9, mostLikely: 4, pessimistic: 2 }, // mis-ordered → skipped
    { optimistic: 0, mostLikely: 0, pessimistic: 12 }, // valid: mean 2, variance 4
  ]);
  assert.equal(r.count, 2);
  assert.equal(r.mean, 6); // 4 + 2
  assert.equal(r.variance, 4.4444); // 16/36 + (12/6)² = 0.4444 + 4
});

test("empty and all-invalid roll-ups ⇒ count 0, null statistics (no divide-by-zero)", () => {
  const empty = rollupPert([]);
  assert.deepEqual(empty, { count: 0, mean: null, variance: null, stdDev: null });
  const allBad = rollupPert([{ optimistic: 5, mostLikely: 1, pessimistic: 0 }]);
  assert.equal(allBad.count, 0);
  assert.equal(allBad.stdDev, null);
});

test("confidence band: mean ± z·stdDev, symmetric, 4 dp", () => {
  const ci = pertInterval(10, 2, 1.96);
  assert.deepEqual(ci, { low: 6.08, high: 13.92 }); // 10 ± 3.92
  // A zero spread collapses the band onto the mean.
  assert.deepEqual(pertInterval(4, 0, 1.645), { low: 4, high: 4 });
});

test("confidence band rejects non-finite inputs and negative spread", () => {
  assert.equal(pertInterval(NaN, 2, 1.96), null);
  assert.equal(pertInterval(10, Infinity, 1.96), null);
  assert.equal(pertInterval(10, 2, NaN), null);
  assert.equal(pertInterval(10, -1, 1.96), null);
});
