import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_ENERGY,
  ENERGY_LEVEL,
  ENERGY_LABEL,
  energyVocabulary,
  energyVocabularyValues,
  energyLevelsForMethodology,
} from "./energy-vocabulary";

test("canonical GTD energy levels are in ascending order with their internal ordinal level", () => {
  assert.deepEqual([...CANONICAL_ENERGY], ["low", "medium", "high"]);
  assert.deepEqual(ENERGY_LEVEL, { low: 1, medium: 2, high: 3 });
});

test("every energy level carries a label", () => {
  for (const e of CANONICAL_ENERGY) assert.ok(ENERGY_LABEL[e], `energy ${e} needs a label`);
});

test("energyVocabularyValues ships the 3 levels with ordinal level, order, methodology tags and colour", () => {
  const { levels } = energyVocabularyValues();
  assert.deepEqual(levels.map((l) => l.id), ["low", "medium", "high"]);
  assert.equal(levels.find((l) => l.id === "low")!.level, 1);
  assert.equal(levels.find((l) => l.id === "high")!.color, "#ef4444");
  // Shipped levels are neutral ("*") — they apply to every methodology.
  for (const l of levels) assert.deepEqual(l.methodologies, ["*"]);
});

test("energyLevelsForMethodology surfaces neutral levels for any methodology", () => {
  const forGtd = energyLevelsForMethodology("gtd");
  assert.ok(forGtd.some((l) => l.id === "low"));
  assert.equal(forGtd.length, CANONICAL_ENERGY.length);
});

test("energyVocabulary returns an independent defensive copy", () => {
  const a = energyVocabulary();
  a[0]!.label = "MUTATED";
  assert.notEqual(energyVocabulary()[0]!.label, "MUTATED");
});
