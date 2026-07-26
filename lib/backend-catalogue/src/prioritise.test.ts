import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreWSJF, prioritiseWSJF, scoreRICE, prioritiseRICE } from "./prioritise";

// ─────────────────────────────────────────── WSJF ───────────────────────────────────────────

test("WSJF: higher cost-of-delay / smaller job ranks first", () => {
  const { ranked } = prioritiseWSJF([
    { id: "big-job", costOfDelay: 20, jobSize: 10 }, // 2.0
    { id: "quick-win", costOfDelay: 15, jobSize: 3 }, // 5.0
    { id: "slog", costOfDelay: 8, jobSize: 8 }, // 1.0
  ]);
  assert.deepEqual(ranked.map((r) => r.id), ["quick-win", "big-job", "slog"]);
  assert.equal(ranked[0]!.score, 5);
  assert.equal(ranked[1]!.score, 2);
  assert.equal(ranked[2]!.score, 1);
});

test("WSJF: cost-of-delay summed from the three SAFe components when not given directly", () => {
  const s = scoreWSJF({ id: "a", userValue: 5, timeCriticality: 3, riskOpportunity: 2, jobSize: 5 });
  assert.equal(s.costOfDelay, 10); // 5 + 3 + 2
  assert.equal(s.score, 2); // 10 / 5
});

test("WSJF: a direct costOfDelay overrides the components", () => {
  const s = scoreWSJF({ id: "a", costOfDelay: 30, userValue: 1, timeCriticality: 1, riskOpportunity: 1, jobSize: 6 });
  assert.equal(s.costOfDelay, 30);
  assert.equal(s.score, 5);
});

test("WSJF: job size 0 ⇒ null score, sorts last (never Infinity)", () => {
  const { ranked } = prioritiseWSJF([
    { id: "undefined-size", costOfDelay: 100, jobSize: 0 },
    { id: "normal", costOfDelay: 4, jobSize: 2 },
  ]);
  assert.equal(ranked[0]!.id, "normal");
  assert.equal(ranked[0]!.score, 2);
  assert.equal(ranked[1]!.id, "undefined-size");
  assert.equal(ranked[1]!.score, null);
});

test("WSJF: equal scores broken deterministically by id ascending", () => {
  const { ranked } = prioritiseWSJF([
    { id: "zulu", costOfDelay: 10, jobSize: 5 }, // 2.0
    { id: "alpha", costOfDelay: 6, jobSize: 3 }, // 2.0
    { id: "mike", costOfDelay: 4, jobSize: 2 }, // 2.0
  ]);
  assert.deepEqual(ranked.map((r) => r.id), ["alpha", "mike", "zulu"]);
});

// ─────────────────────────────────────────── RICE ───────────────────────────────────────────

test("RICE: reach × impact × confidence ÷ effort, ranked high first", () => {
  const { ranked } = prioritiseRICE([
    { id: "small", reach: 100, impact: 1, confidence: 1, effort: 5 }, // 20
    { id: "wide", reach: 1000, impact: 2, confidence: 0.8, effort: 4 }, // 400
    { id: "meh", reach: 50, impact: 0.5, confidence: 1, effort: 5 }, // 5
  ]);
  assert.deepEqual(ranked.map((r) => r.id), ["wide", "small", "meh"]);
  assert.equal(ranked[0]!.score, 400);
  assert.equal(ranked[1]!.score, 20);
  assert.equal(ranked[2]!.score, 5);
});

test("RICE: confidence given as a percentage (80) is coerced to 0.8", () => {
  const s = scoreRICE({ id: "a", reach: 1000, impact: 2, confidence: 80, effort: 4 });
  assert.equal(s.confidence, 0.8);
  assert.equal(s.score, 400); // 1000 * 2 * 0.8 / 4
});

test("RICE: confidence above 100% clamps to 1, at/below 0 clamps to 0", () => {
  assert.equal(scoreRICE({ id: "a", reach: 10, impact: 1, confidence: 150, effort: 1 }).confidence, 1);
  assert.equal(scoreRICE({ id: "b", reach: 10, impact: 1, confidence: -5, effort: 1 }).confidence, 0);
  assert.equal(scoreRICE({ id: "b", reach: 10, impact: 1, confidence: -5, effort: 1 }).score, 0);
});

test("RICE: effort 0 ⇒ null score, sorts last (never Infinity)", () => {
  const { ranked } = prioritiseRICE([
    { id: "no-effort", reach: 1000, impact: 3, confidence: 1, effort: 0 },
    { id: "normal", reach: 10, impact: 1, confidence: 1, effort: 5 }, // 2
  ]);
  assert.equal(ranked[0]!.id, "normal");
  assert.equal(ranked[1]!.id, "no-effort");
  assert.equal(ranked[1]!.score, null);
});

// ─────────────────────────────────── validation + edges ─────────────────────────────────────

test("dirty / non-finite inputs are coerced to finite numbers, never NaN", () => {
  const s = scoreRICE({ id: "dirty", reach: "1000" as unknown as number, impact: NaN as unknown as number, confidence: 0.5, effort: 5 });
  // impact NaN ⇒ 0, so the product is 0 (finite), not NaN.
  assert.equal(Number.isFinite(s.score as number), true);
  assert.equal(s.score, 0);
  const w = scoreWSJF({ id: "dirty", costOfDelay: Infinity as unknown as number, jobSize: 4 });
  assert.equal(w.costOfDelay, 0); // ±Infinity coerced to 0
  assert.equal(w.score, 0);
});

test("empty input ⇒ empty ranking for both models", () => {
  assert.deepEqual(prioritiseWSJF([]).ranked, []);
  assert.deepEqual(prioritiseRICE([]).ranked, []);
});

test("identical input yields an identical ranking (deterministic, no Math.random)", () => {
  const items = [
    { id: "b", reach: 10, impact: 1, confidence: 1, effort: 2 },
    { id: "a", reach: 10, impact: 1, confidence: 1, effort: 2 },
    { id: "c", reach: 99, impact: 1, confidence: 1, effort: 3 },
  ];
  assert.deepEqual(prioritiseRICE(items).ranked, prioritiseRICE(items).ranked);
});
