import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_TASK_STATUS,
  TASK_STATUS_CLASS,
  TASK_STATUS_LABEL,
  taskVocabulary,
  taskVocabularyValues,
  taskStatusesForMethodology,
  taskStatusClassOf,
  isTaskStatusClosed,
  isTaskStatusDone,
  TASK_CLOSED_STATUSES,
} from "./task-vocabulary";

test("canonical GTD task statuses are in workflow order with their workflow class", () => {
  assert.deepEqual([...CANONICAL_TASK_STATUS], ["next", "waiting", "scheduled", "someday", "done", "dropped"]);
  assert.deepEqual(TASK_STATUS_CLASS, {
    next: "actionable",
    waiting: "waiting",
    scheduled: "deferred",
    someday: "deferred",
    done: "done",
    dropped: "dropped",
  });
});

test("the GTD axis keeps its richer FIVE workflow classes (not the four issue lifecycle classes)", () => {
  const classes = new Set(Object.values(TASK_STATUS_CLASS));
  assert.deepEqual([...classes].sort(), ["actionable", "deferred", "done", "dropped", "waiting"]);
});

test("every task status carries a label", () => {
  for (const s of CANONICAL_TASK_STATUS) assert.ok(TASK_STATUS_LABEL[s], `status ${s} needs a label`);
});

test("taskVocabularyValues ships the 6 statuses with class, order, methodology tags and colour", () => {
  const { statuses } = taskVocabularyValues();
  assert.deepEqual(statuses.map((s) => s.id), ["next", "waiting", "scheduled", "someday", "done", "dropped"]);
  assert.equal(statuses.find((s) => s.id === "next")!.class, "actionable");
  assert.equal(statuses.find((s) => s.id === "done")!.color, "#22c55e");
  // Shipped statuses are neutral ("*") — they apply to every methodology.
  for (const s of statuses) assert.deepEqual(s.methodologies, ["*"]);
});

test("taskStatusesForMethodology surfaces neutral statuses for any methodology", () => {
  const forGtd = taskStatusesForMethodology("gtd");
  assert.ok(forGtd.some((s) => s.id === "next"));
  assert.equal(forGtd.length, CANONICAL_TASK_STATUS.length);
});

test("closed-status meaning derives from the class binding (the one home, not a hand-list)", () => {
  // done/dropped are CLOSED; the actionable/waiting/deferred classes are OPEN.
  assert.equal(taskStatusClassOf("done"), "done");
  assert.equal(isTaskStatusClosed("done"), true);
  assert.equal(isTaskStatusClosed("dropped"), true);
  assert.equal(isTaskStatusDone("done"), true);
  assert.equal(isTaskStatusDone("dropped"), false);
  assert.equal(isTaskStatusClosed("next"), false);
  assert.equal(isTaskStatusClosed("no-such"), false);
  // The closed set is exactly the canonical statuses whose class is done/dropped.
  assert.deepEqual([...TASK_CLOSED_STATUSES].sort(), CANONICAL_TASK_STATUS.filter((s) => ["done", "dropped"].includes(TASK_STATUS_CLASS[s])).sort());
});

test("taskVocabulary returns an independent defensive copy", () => {
  const a = taskVocabulary();
  a[0]!.label = "MUTATED";
  assert.notEqual(taskVocabulary()[0]!.label, "MUTATED");
});
