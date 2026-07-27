import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyHealth, scoreHealth, scoreHealthPortfolio } from "./health-score";

test("classifyHealth maps severity to canonical RAG via the default 0.33/0.66 thresholds", () => {
  assert.equal(classifyHealth(0), "green");
  assert.equal(classifyHealth(0.33), "green");
  assert.equal(classifyHealth(0.5), "amber");
  assert.equal(classifyHealth(0.66), "amber");
  assert.equal(classifyHealth(0.9), "red");
  assert.equal(classifyHealth(1), "red");
});

test("scoreHealth weight-averages dimension severities into a banded composite", () => {
  const r = scoreHealth({
    id: "epic-1",
    dimensions: [
      { id: "dependencies", severity: 0.9, weight: 2 },
      { id: "timeline", severity: 0.3, weight: 1 },
    ],
  });
  // (0.9*2 + 0.3*1) / 3 = 0.7 ⇒ red
  assert.equal(r.score, 0.7);
  assert.equal(r.band, "red");
});

test("reasons list amber/red dimensions worst-first, in plain English", () => {
  const r = scoreHealth({
    id: "epic-1",
    dimensions: [
      { id: "timeline", label: "Timeline", severity: 0.5 },
      { id: "dependencies", label: "Dependencies", severity: 0.9 },
      { id: "ownership", label: "Ownership", severity: 0.1 }, // green ⇒ not a reason
    ],
  });
  assert.deepEqual(r.reasons, ["Dependencies: Red (0.9)", "Timeline: Amber (0.5)"]);
});

test("an all-green initiative has no reasons", () => {
  const r = scoreHealth({ id: "ok", dimensions: [{ id: "a", severity: 0.1 }, { id: "b", severity: 0.2 }] });
  assert.equal(r.band, "green");
  assert.deepEqual(r.reasons, []);
});

test("no dimensions ⇒ null score, green band, guarded (never NaN)", () => {
  const r = scoreHealth({ id: "empty", dimensions: [] });
  assert.equal(r.score, null);
  assert.equal(r.band, "green");
  assert.deepEqual(r.reasons, []);
});

test("zero total weight ⇒ null score (divide guarded), never NaN", () => {
  const r = scoreHealth({ id: "z", dimensions: [{ id: "a", severity: 0.9, weight: 0 }] });
  assert.equal(r.score, null);
  assert.equal(r.band, "green");
  assert.equal(Number.isNaN(r.score as unknown as number), false);
});

test("severity and weight are coerced + clamped (dirty input never yields NaN)", () => {
  const r = scoreHealth({
    id: "dirty",
    dimensions: [
      { id: "a", severity: "0.8" as unknown as number, weight: "2" as unknown as number },
      { id: "b", severity: 5 as unknown as number, weight: NaN as unknown as number }, // severity clamps to 1, weight → 0
    ],
  });
  const a = r.dimensions.find((d) => d.id === "a")!;
  const b = r.dimensions.find((d) => d.id === "b")!;
  assert.equal(a.severity, 0.8);
  assert.equal(b.severity, 1); // clamped
  assert.equal(b.weight, 0);
  assert.equal(r.score, 0.8); // b contributes 0 weight ⇒ composite = a's severity
  assert.equal(Number.isNaN(r.score as number), false);
});

test("custom thresholds move the band boundaries", () => {
  const strict = scoreHealth({ id: "x", dimensions: [{ id: "a", severity: 0.4 }] }, { greenMax: 0.2, amberMax: 0.5 });
  assert.equal(strict.band, "amber"); // 0.4 > 0.2 but ≤ 0.5
});

test("portfolio ranks worst band first, then highest severity, deterministic id tiebreak", () => {
  const { ranked, counts } = scoreHealthPortfolio([
    { id: "green-one", dimensions: [{ id: "d", severity: 0.1 }] },
    { id: "red-hi", dimensions: [{ id: "d", severity: 0.95 }] },
    { id: "red-lo", dimensions: [{ id: "d", severity: 0.7 }] },
    { id: "amber-one", dimensions: [{ id: "d", severity: 0.5 }] },
  ]);
  assert.deepEqual(ranked.map((r) => r.id), ["red-hi", "red-lo", "amber-one", "green-one"]);
  assert.deepEqual(counts, { red: 2, amber: 1, green: 1 });
});

test("empty portfolio ⇒ empty ranking, zero counts", () => {
  const r = scoreHealthPortfolio([]);
  assert.deepEqual(r.ranked, []);
  assert.deepEqual(r.counts, { red: 0, amber: 0, green: 0 });
});

test("equal band + equal score ⇒ deterministic id-ascending tiebreak", () => {
  const { ranked } = scoreHealthPortfolio([
    { id: "zulu", dimensions: [{ id: "d", severity: 0.9 }] },
    { id: "alpha", dimensions: [{ id: "d", severity: 0.9 }] },
  ]);
  assert.deepEqual(ranked.map((r) => r.id), ["alpha", "zulu"]);
});
