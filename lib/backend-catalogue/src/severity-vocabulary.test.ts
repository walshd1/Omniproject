import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_SEVERITY,
  SEVERITY_LEVEL,
  SEVERITY_LABEL,
  severityVocabulary,
  severityVocabularyValues,
  severityLevelsForMethodology,
} from "./severity-vocabulary";

test("canonical RAID severity grades are in ascending order with their internal ordinal level", () => {
  assert.deepEqual([...CANONICAL_SEVERITY], ["low", "medium", "high", "critical"]);
  assert.deepEqual(SEVERITY_LEVEL, { low: 1, medium: 2, high: 3, critical: 4 });
});

test("every severity grade carries a label", () => {
  for (const e of CANONICAL_SEVERITY) assert.ok(SEVERITY_LABEL[e], `severity ${e} needs a label`);
});

test("severityVocabularyValues ships the 4 grades with ordinal level, order, methodology tags and colour", () => {
  const { levels } = severityVocabularyValues();
  assert.deepEqual(levels.map((l) => l.id), ["low", "medium", "high", "critical"]);
  assert.equal(levels.find((l) => l.id === "low")!.level, 1);
  assert.equal(levels.find((l) => l.id === "critical")!.level, 4);
  assert.equal(levels.find((l) => l.id === "high")!.color, "#ef4444");
  // Shipped grades are neutral ("*") — they apply to every methodology.
  for (const l of levels) assert.deepEqual(l.methodologies, ["*"]);
});

test("severityLevelsForMethodology surfaces neutral grades for any methodology", () => {
  const forGtd = severityLevelsForMethodology("gtd");
  assert.ok(forGtd.some((l) => l.id === "critical"));
  assert.equal(forGtd.length, CANONICAL_SEVERITY.length);
});

test("severityVocabulary returns an independent defensive copy", () => {
  const a = severityVocabulary();
  a[0]!.label = "MUTATED";
  assert.notEqual(severityVocabulary()[0]!.label, "MUTATED");
});
