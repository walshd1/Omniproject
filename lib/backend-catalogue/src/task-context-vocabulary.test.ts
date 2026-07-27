import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_TASK_CONTEXT,
  TASK_CONTEXT_LABEL,
  taskContextVocabulary,
  taskContextVocabularyValues,
  taskContextsForMethodology,
} from "./task-context-vocabulary";

test("canonical GTD contexts are the shipped set in display order", () => {
  assert.deepEqual([...CANONICAL_TASK_CONTEXT], ["anywhere", "calls", "computer", "errands", "home", "office"]);
});

test("every context carries a label", () => {
  for (const c of CANONICAL_TASK_CONTEXT) assert.ok(TASK_CONTEXT_LABEL[c], `context ${c} needs a label`);
});

test("taskContextVocabularyValues ships the contexts with order, colour and neutral methodology tags", () => {
  const { contexts } = taskContextVocabularyValues();
  assert.deepEqual(contexts.map((c) => c.id), ["anywhere", "calls", "computer", "errands", "home", "office"]);
  assert.equal(contexts.find((c) => c.id === "calls")!.color, "#06b6d4");
  // Contexts are flat — a display order, no internal ordinal level.
  assert.equal((contexts[0] as unknown as { level?: number }).level, undefined);
  for (const c of contexts) assert.deepEqual(c.methodologies, ["*"]);
});

test("contexts are sorted by order", () => {
  const orders = taskContextVocabularyValues().contexts.map((c) => c.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
});

test("taskContextsForMethodology surfaces neutral contexts for any methodology", () => {
  const forGtd = taskContextsForMethodology("gtd");
  assert.ok(forGtd.some((c) => c.id === "calls"));
  assert.equal(forGtd.length, CANONICAL_TASK_CONTEXT.length);
});

test("taskContextVocabulary returns an independent defensive copy", () => {
  const a = taskContextVocabulary();
  a[0]!.label = "MUTATED";
  assert.notEqual(taskContextVocabulary()[0]!.label, "MUTATED");
});
