import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_IMPACT,
  IMPACT_LEVEL,
  IMPACT_LABEL,
  impactVocabulary,
  impactVocabularyValues,
  impactLevelsForMethodology,
} from "./impact-vocabulary";

test("canonical RAID impact grades are in ascending order with their internal ordinal level", () => {
  assert.deepEqual([...CANONICAL_IMPACT], ["low", "medium", "high"]);
  assert.deepEqual(IMPACT_LEVEL, { low: 1, medium: 2, high: 3 });
});

test("every impact grade carries a label", () => {
  for (const e of CANONICAL_IMPACT) assert.ok(IMPACT_LABEL[e], `impact ${e} needs a label`);
});

test("impactVocabularyValues ships the 3 grades with ordinal level, order, methodology tags and colour", () => {
  const { levels } = impactVocabularyValues();
  assert.deepEqual(levels.map((l) => l.id), ["low", "medium", "high"]);
  assert.equal(levels.find((l) => l.id === "low")!.level, 1);
  assert.equal(levels.find((l) => l.id === "high")!.color, "#ef4444");
  // Shipped grades are neutral ("*") — they apply to every methodology.
  for (const l of levels) assert.deepEqual(l.methodologies, ["*"]);
});

test("impactLevelsForMethodology surfaces neutral grades for any methodology", () => {
  const forGtd = impactLevelsForMethodology("gtd");
  assert.ok(forGtd.some((l) => l.id === "low"));
  assert.equal(forGtd.length, CANONICAL_IMPACT.length);
});

test("impactVocabulary returns an independent defensive copy", () => {
  const a = impactVocabulary();
  a[0]!.label = "MUTATED";
  assert.notEqual(impactVocabulary()[0]!.label, "MUTATED");
});
