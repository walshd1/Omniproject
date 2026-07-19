import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_STATUS,
  WORK_PRIORITIES,
  STATUS_CLASS,
  STATUS_LABEL,
  PRIORITY_LABEL,
  workVocabulary,
} from "./work-vocabulary";

test("canonical statuses are in board order with their lifecycle class", () => {
  assert.deepEqual([...CANONICAL_STATUS], ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"]);
  assert.deepEqual(STATUS_CLASS, {
    backlog: "open",
    todo: "open",
    in_progress: "active",
    in_review: "active",
    done: "done",
    cancelled: "cancelled",
  });
});

test("canonical priorities are in ranked order", () => {
  assert.deepEqual([...WORK_PRIORITIES], ["urgent", "high", "medium", "low", "none"]);
});

test("every status/priority carries a label", () => {
  for (const s of CANONICAL_STATUS) assert.ok(STATUS_LABEL[s], `status ${s} needs a label`);
  for (const p of WORK_PRIORITIES) assert.ok(PRIORITY_LABEL[p], `priority ${p} needs a label`);
});

test("workVocabulary returns an independent defensive copy", () => {
  const a = workVocabulary();
  a[0]!.label = "MUTATED";
  assert.notEqual(workVocabulary()[0]!.label, "MUTATED");
});
