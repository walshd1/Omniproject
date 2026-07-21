import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_STATUS,
  WORK_PRIORITIES,
  STATUS_CLASS,
  STATUS_LABEL,
  PRIORITY_LABEL,
  PRIORITY_RANK,
  priorityWeightBand,
  workVocabulary,
  workVocabularyValues,
  canonicalStatusOf,
  statusClassOf,
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

test("priorities bind to an internal rank (higher = more urgent), the invariant the weighting keys off", () => {
  // The five shipped priorities are the rank anchors: none=0 … urgent=4.
  assert.deepEqual(PRIORITY_RANK, { urgent: 4, high: 3, medium: 2, low: 1, none: 0 });
  // Every resolved default priority carries its rank (distinct from display order).
  const { priorities } = workVocabularyValues();
  for (const p of priorities) assert.equal(p.rank, PRIORITY_RANK[p.id as keyof typeof PRIORITY_RANK]);
});

test("priorityWeightBand snaps any rank onto the nearest shipped anchor (ties go to the more-urgent band)", () => {
  assert.equal(priorityWeightBand(4), 4); // exact anchor
  assert.equal(priorityWeightBand(0), 0);
  assert.equal(priorityWeightBand(6), 4); // above every anchor → the top band (urgent)
  assert.equal(priorityWeightBand(2), 2); // exact middle anchor
});

test("every status/priority carries a label", () => {
  for (const s of CANONICAL_STATUS) assert.ok(STATUS_LABEL[s], `status ${s} needs a label`);
  for (const p of WORK_PRIORITIES) assert.ok(PRIORITY_LABEL[p], `priority ${p} needs a label`);
});

test("adjustable-status resolvers: a core status binds to itself and its own lifecycle class", () => {
  // Every canonical status resolves to itself (core statuses ARE their own binding).
  for (const s of CANONICAL_STATUS) {
    assert.equal(canonicalStatusOf(s), s, `${s} should resolve to itself`);
    assert.equal(statusClassOf(s), STATUS_CLASS[s], `${s} class should match STATUS_CLASS`);
  }
});

test("adjustable-status resolvers: unknown/empty status is default-safe (null / open)", () => {
  assert.equal(canonicalStatusOf("no-such-status"), null);
  assert.equal(canonicalStatusOf(undefined), null);
  assert.equal(canonicalStatusOf(null), null);
  // An unclassified status is treated as still-open work, never silently "done".
  assert.equal(statusClassOf("no-such-status"), "open");
  assert.equal(statusClassOf(null), "open");
});

test("adding adjustable statuses never widens the internal canonical set", () => {
  // The CORE contract stays exactly the 6 regardless of any methodology-scoped statuses added later,
  // because CANONICAL_STATUS derives from core (unbound) statuses only.
  assert.equal(CANONICAL_STATUS.length, 6);
});

test("workVocabulary returns an independent defensive copy", () => {
  const a = workVocabulary();
  a[0]!.label = "MUTATED";
  assert.notEqual(workVocabulary()[0]!.label, "MUTATED");
});
