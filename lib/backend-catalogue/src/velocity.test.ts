import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVelocity } from "./velocity";

test("computes mean / median / min / max / stdDev over a steady series", () => {
  const r = computeVelocity({ throughput: [4, 6, 5, 5] });
  assert.equal(r.count, 4);
  assert.equal(r.mean, 5);
  assert.equal(r.median, 5);
  assert.equal(r.min, 4);
  assert.equal(r.max, 6);
  assert.equal(r.stdDev, 0.71); // population stddev of [4,6,5,5]
});

test("a perfectly steady team has zero spread and predictability 1", () => {
  const r = computeVelocity({ throughput: [5, 5, 5, 5] });
  assert.equal(r.stdDev, 0);
  assert.equal(r.coefficientOfVariation, 0);
  assert.equal(r.predictability, 1);
  assert.deepEqual(r.anchors, { optimistic: 5, likely: 5, pessimistic: 5 });
});

test("anchors are mean ± one stdDev, pessimistic floored at 0", () => {
  const r = computeVelocity({ throughput: [0, 10] }); // mean 5, stdDev 5
  assert.equal(r.mean, 5);
  assert.equal(r.stdDev, 5);
  assert.deepEqual(r.anchors, { optimistic: 10, likely: 5, pessimistic: 0 }); // 5-5 floored at 0
});

test("rolling average is a trailing window; recent = mean of the last window", () => {
  const r = computeVelocity({ throughput: [3, 6, 9, 12], window: 2 });
  // trailing 2-period means: [3, 4.5, 7.5, 10.5]
  assert.deepEqual(r.rolling, [3, 4.5, 7.5, 10.5]);
  assert.equal(r.recent, 10.5); // mean of last 2: (9+12)/2
});

test("window defaults to 3 and clamps to >= 1", () => {
  const d = computeVelocity({ throughput: [2, 4, 6, 8] }); // default window 3
  assert.equal(d.recent, 6); // mean of last 3: (4+6+8)/3
  const clamped = computeVelocity({ throughput: [2, 4, 6, 8], window: 0 }); // clamps to 1
  assert.equal(clamped.recent, 8); // mean of last 1
});

test("median handles even-length series", () => {
  assert.equal(computeVelocity({ throughput: [1, 2, 3, 4] }).median, 2.5);
  assert.equal(computeVelocity({ throughput: [1, 2, 3] }).median, 2);
});

test("empty ⇒ zeroed with null CoV/predictability and zero anchors", () => {
  const r = computeVelocity({ throughput: [] });
  assert.equal(r.count, 0);
  assert.equal(r.mean, 0);
  assert.equal(r.coefficientOfVariation, null);
  assert.equal(r.predictability, null);
  assert.deepEqual(r.anchors, { optimistic: 0, likely: 0, pessimistic: 0 });
  assert.deepEqual(r.rolling, []);
});

test("all-zero throughput ⇒ mean 0, CoV/predictability null (guarded divide, never NaN)", () => {
  const r = computeVelocity({ throughput: [0, 0, 0] });
  assert.equal(r.mean, 0);
  assert.equal(r.coefficientOfVariation, null);
  assert.equal(r.predictability, null);
});

test("malformed input tolerated: dirty entries ⇒ 0, negatives floored, never throws", () => {
  const r = computeVelocity({ throughput: [5, "nope", -3, null, 10] as unknown as number[] });
  // coerced to [5, 0, 0, 0, 10]; mean 3
  assert.equal(r.count, 5);
  assert.equal(r.mean, 3);
  assert.equal(r.min, 0);
  assert.equal(r.max, 10);
  assert.ok(Number.isFinite(r.stdDev));
});

test("non-array throughput ⇒ empty result, never throws", () => {
  const r = computeVelocity({ throughput: undefined as unknown as number[] });
  assert.equal(r.count, 0);
  assert.deepEqual(r.anchors, { optimistic: 0, likely: 0, pessimistic: 0 });
});

test("deterministic: same input ⇒ identical output", () => {
  const a = computeVelocity({ throughput: [3, 5, 8, 2, 6], window: 3 });
  const b = computeVelocity({ throughput: [3, 5, 8, 2, 6], window: 3 });
  assert.deepEqual(a, b);
});
