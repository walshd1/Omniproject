import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_LIKELIHOOD,
  LIKELIHOOD_LEVEL,
  LIKELIHOOD_LABEL,
  likelihoodVocabulary,
  likelihoodVocabularyValues,
  likelihoodLevelsForMethodology,
} from "./likelihood-vocabulary";

test("canonical RAID likelihood grades are in ascending order with their internal ordinal level", () => {
  assert.deepEqual([...CANONICAL_LIKELIHOOD], ["low", "medium", "high"]);
  assert.deepEqual(LIKELIHOOD_LEVEL, { low: 1, medium: 2, high: 3 });
});

test("every likelihood grade carries a label", () => {
  for (const e of CANONICAL_LIKELIHOOD) assert.ok(LIKELIHOOD_LABEL[e], `likelihood ${e} needs a label`);
});

test("likelihoodVocabularyValues ships the 3 grades with ordinal level, order, methodology tags and colour", () => {
  const { levels } = likelihoodVocabularyValues();
  assert.deepEqual(levels.map((l) => l.id), ["low", "medium", "high"]);
  assert.equal(levels.find((l) => l.id === "low")!.level, 1);
  assert.equal(levels.find((l) => l.id === "high")!.color, "#ef4444");
  // Shipped grades are neutral ("*") — they apply to every methodology.
  for (const l of levels) assert.deepEqual(l.methodologies, ["*"]);
});

test("likelihoodLevelsForMethodology surfaces neutral grades for any methodology", () => {
  const forGtd = likelihoodLevelsForMethodology("gtd");
  assert.ok(forGtd.some((l) => l.id === "low"));
  assert.equal(forGtd.length, CANONICAL_LIKELIHOOD.length);
});

test("likelihoodVocabulary returns an independent defensive copy", () => {
  const a = likelihoodVocabulary();
  a[0]!.label = "MUTATED";
  assert.notEqual(likelihoodVocabulary()[0]!.label, "MUTATED");
});
