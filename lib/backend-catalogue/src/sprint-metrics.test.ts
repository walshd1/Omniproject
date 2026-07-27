import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSprintMetrics, type SprintItem } from "./sprint-metrics";
import { computeVelocity } from "./velocity";

const I = (id: string, sprintId: string, extra: Partial<SprintItem> = {}): SprintItem => ({ id, sprintId, status: "todo", points: 0, ...extra });

test("per-sprint committed vs completed points + completion rate", () => {
  const items: SprintItem[] = [
    I("a", "s1", { status: "done", points: 3 }),
    I("b", "s1", { status: "done", points: 2 }),
    I("c", "s1", { status: "in_progress", points: 5 }),
  ];
  const { sprints } = computeSprintMetrics(items, { sprintOrder: ["s1"] });
  const s = sprints[0]!;
  assert.equal(s.committedPoints, 10);
  assert.equal(s.completedPoints, 5); // a + b done
  assert.equal(s.completionRate, 0.5);
  assert.equal(s.carryoverPoints, 5); // c not done
  assert.equal(s.carryoverItems, 1);
});

test("added-mid-sprint items are scope churn, not part of the commitment", () => {
  const items: SprintItem[] = [
    I("a", "s1", { status: "done", points: 4 }), // committed
    I("b", "s1", { status: "done", points: 2, added: true }), // added mid-sprint
  ];
  const { sprints } = computeSprintMetrics(items, { sprintOrder: ["s1"] });
  const s = sprints[0]!;
  assert.equal(s.committedPoints, 4); // only a
  assert.equal(s.addedPoints, 2); // b
  assert.equal(s.completedPoints, 6); // both done
  assert.equal(s.scopeChangeRate, 0.5); // 2 added / 4 committed
  assert.equal(s.totalPoints, 6);
});

test("committed:false excludes an item from the commitment without marking it added", () => {
  const items: SprintItem[] = [I("a", "s1", { status: "done", points: 5, committed: false })];
  const { sprints } = computeSprintMetrics(items, { sprintOrder: ["s1"] });
  assert.equal(sprints[0]!.committedPoints, 0);
  assert.equal(sprints[0]!.addedPoints, 0);
  assert.equal(sprints[0]!.completedPoints, 5);
});

test("emits a velocity series in sprint order that feeds computeVelocity", () => {
  const items: SprintItem[] = [
    I("a", "s1", { status: "done", points: 4 }),
    I("b", "s2", { status: "done", points: 6 }),
    I("c", "s3", { status: "done", points: 8 }),
  ];
  const { velocitySeries } = computeSprintMetrics(items, { sprintOrder: ["s1", "s2", "s3"] });
  assert.deepEqual(velocitySeries, [4, 6, 8]);
  // the series is exactly what the velocity engine consumes
  assert.equal(computeVelocity({ throughput: velocitySeries }).mean, 6);
});

test("sprintOrder controls output order; unlisted sprints follow id-sorted", () => {
  const items: SprintItem[] = [I("a", "s3"), I("b", "s1"), I("c", "s2")];
  const { sprints } = computeSprintMetrics(items, { sprintOrder: ["s2"] });
  assert.deepEqual(sprints.map((s) => s.sprintId), ["s2", "s1", "s3"]); // s2 first, then s1,s3 sorted
});

test("items with no sprint id are skipped", () => {
  const items = [I("a", "s1", { status: "done", points: 3 }), { id: "x", status: "done", points: 99 }] as SprintItem[];
  const { sprints, summary } = computeSprintMetrics(items);
  assert.equal(sprints.length, 1);
  assert.equal(summary.completedPoints, 3); // x excluded
});

test("summary rolls up across sprints", () => {
  const items: SprintItem[] = [
    I("a", "s1", { status: "done", points: 4 }),
    I("b", "s1", { status: "todo", points: 6 }),
    I("c", "s2", { status: "done", points: 5, added: true }),
  ];
  const { summary } = computeSprintMetrics(items);
  assert.equal(summary.sprints, 2);
  assert.equal(summary.committedPoints, 10); // a+b (c is added)
  assert.equal(summary.completedPoints, 9); // a + c
  assert.equal(summary.addedPoints, 5);
  assert.equal(summary.carryoverPoints, 6); // b
  assert.equal(summary.meanVelocity, 4.5); // 9 / 2
  assert.equal(summary.overallCompletionRate, 0.9); // 9 / 10
});

test("guarded divides: a sprint with zero committed points ⇒ null rates, never NaN", () => {
  const items: SprintItem[] = [I("a", "s1", { status: "done", points: 5, added: true })]; // nothing committed
  const { sprints } = computeSprintMetrics(items, { sprintOrder: ["s1"] });
  assert.equal(sprints[0]!.completionRate, null);
  assert.equal(sprints[0]!.scopeChangeRate, null);
});

test("empty ⇒ empty", () => {
  const r = computeSprintMetrics([]);
  assert.deepEqual(r.sprints, []);
  assert.deepEqual(r.velocitySeries, []);
  assert.deepEqual(r.summary, { sprints: 0, committedPoints: 0, completedPoints: 0, addedPoints: 0, carryoverPoints: 0, meanVelocity: 0, overallCompletionRate: null });
});

test("malformed input tolerated: non-objects dropped, ids coerced, dirty points ⇒ 0, never throws", () => {
  const dirty = [
    null,
    42,
    { id: 7, sprintId: 1, status: "done", points: "xyz" }, // numeric ids coerced; dirty points ⇒ 0
    { id: "  ", sprintId: "s1" }, // blank id dropped
  ] as unknown as SprintItem[];
  const { sprints, summary } = computeSprintMetrics(dirty);
  assert.equal(sprints.length, 1); // sprint "1"
  assert.equal(sprints[0]!.sprintId, "1");
  assert.equal(sprints[0]!.completedPoints, 0);
  assert.equal(summary.sprints, 1);
});

test("deterministic: same input ⇒ identical output", () => {
  const items: SprintItem[] = [I("a", "s1", { status: "done", points: 3 }), I("b", "s2", { points: 5 })];
  assert.deepEqual(computeSprintMetrics(items), computeSprintMetrics(items));
});
