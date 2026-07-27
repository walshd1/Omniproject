import { test } from "node:test";
import assert from "node:assert/strict";
import { keyResultProgress, rollUpObjective, rollUpObjectives } from "./okr-linkage";

test("a numeric key result is a clamped start→target ramp", () => {
  assert.equal(keyResultProgress({ id: "k", kind: "number", start: 0, target: 100, current: 40 }), 0.4);
  assert.equal(keyResultProgress({ id: "k", kind: "number", start: 20, target: 120, current: 70 }), 0.5);
  assert.equal(keyResultProgress({ id: "k", kind: "percent", start: 0, target: 100, current: 200 }), 1); // clamp high
  assert.equal(keyResultProgress({ id: "k", kind: "currency", start: 0, target: 100, current: -50 }), 0); // clamp low
});

test("a milestone key result is binary (met or not)", () => {
  assert.equal(keyResultProgress({ id: "k", kind: "milestone", target: 1, current: 1 }), 1);
  assert.equal(keyResultProgress({ id: "k", kind: "milestone", target: 1, current: 0 }), 0);
});

test("an empty target range (target === start) ⇒ null, never a divide-by-zero", () => {
  assert.equal(keyResultProgress({ id: "k", kind: "number", start: 50, target: 50, current: 50 }), null);
});

test("objective OKR progress is the weighted mean of its key results", () => {
  const r = rollUpObjective({
    id: "obj",
    keyResults: [
      { id: "a", kind: "number", start: 0, target: 100, current: 90, weight: 3 }, // 0.9
      { id: "b", kind: "number", start: 0, target: 100, current: 10, weight: 1 }, // 0.1
    ],
  });
  assert.equal(r.keyResultProgress, 0.7); // (0.9*3 + 0.1*1) / 4
  assert.equal(r.progress, 0.7); // headline = OKR progress when key results exist
  assert.equal(r.status, "on-track");
});

test("delivery progress rolls up separately and the gap surfaces divergence", () => {
  const r = rollUpObjective({
    id: "obj",
    keyResults: [{ id: "a", kind: "number", start: 0, target: 100, current: 80 }], // 0.8
    deliveryItems: [{ id: "e1", progress: 0.3 }, { id: "e2", progress: 0.3 }], // 0.3
  });
  assert.equal(r.keyResultProgress, 0.8);
  assert.equal(r.deliveryProgress, 0.3);
  assert.equal(r.progress, 0.8); // headline prefers OKR progress
  assert.equal(r.deliveryGap, -0.5); // delivery lags the OKR claim by 0.5
  assert.equal(r.linkedItems, 2);
});

test("with no key results, delivery progress becomes the headline", () => {
  const r = rollUpObjective({ id: "obj", deliveryItems: [{ id: "e1", progress: 0.6 }, { id: "e2", progress: 0.4 }] });
  assert.equal(r.keyResultProgress, null);
  assert.equal(r.deliveryProgress, 0.5);
  assert.equal(r.progress, 0.5);
  assert.equal(r.deliveryGap, null); // no OKR side to compare
  assert.equal(r.status, "at-risk");
});

test("status bands (on-track / at-risk / off-track / unknown) honour the thresholds", () => {
  const mk = (current: number) => rollUpObjective({ id: "o", keyResults: [{ id: "k", kind: "number", start: 0, target: 100, current }] }).status;
  assert.equal(mk(80), "on-track"); // ≥ 0.7
  assert.equal(mk(50), "at-risk"); // ≥ 0.4
  assert.equal(mk(10), "off-track"); // < 0.4
  const empty = rollUpObjective({ id: "o" });
  assert.equal(empty.progress, null);
  assert.equal(empty.status, "unknown");
});

test("custom thresholds move the band boundaries", () => {
  const r = rollUpObjective(
    { id: "o", keyResults: [{ id: "k", kind: "number", start: 0, target: 100, current: 55 }] },
    { onTrackMin: 0.5, atRiskMin: 0.2 },
  );
  assert.equal(r.status, "on-track"); // 0.55 ≥ custom 0.5
});

test("zero-weight key results ⇒ null OKR progress (divide guarded), never NaN", () => {
  const r = rollUpObjective({ id: "o", keyResults: [{ id: "k", kind: "number", start: 0, target: 100, current: 50, weight: 0 }] });
  assert.equal(r.keyResultProgress, null);
  assert.equal(r.progress, null);
  assert.equal(r.status, "unknown");
});

test("dirty / non-finite inputs are coerced, never NaN", () => {
  const r = rollUpObjective({
    id: "o",
    keyResults: [{ id: "k", kind: "number", start: 0, target: "100" as unknown as number, current: "25" as unknown as number }],
    deliveryItems: [{ id: "e", progress: NaN as unknown as number }], // → 0
  });
  assert.equal(r.keyResultProgress, 0.25);
  assert.equal(r.deliveryProgress, 0);
  assert.equal(Number.isNaN(r.progress as number), false);
});

test("portfolio roll-up: mean of measured objectives + status counts; empty ⇒ null mean", () => {
  const r = rollUpObjectives([
    { id: "hi", keyResults: [{ id: "k", kind: "number", start: 0, target: 100, current: 90 }] }, // 0.9 on-track
    { id: "lo", keyResults: [{ id: "k", kind: "number", start: 0, target: 100, current: 10 }] }, // 0.1 off-track
    { id: "none" }, // unknown, excluded from mean
  ]);
  assert.equal(r.meanProgress, 0.5); // (0.9 + 0.1) / 2
  assert.deepEqual(r.counts, { "on-track": 1, "at-risk": 0, "off-track": 1, unknown: 1 });

  const empty = rollUpObjectives([]);
  assert.equal(empty.meanProgress, null);
  assert.deepEqual(empty.objectives, []);
});
