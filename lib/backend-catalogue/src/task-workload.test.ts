import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeTaskWorkload, type WorkloadTask } from "./task-workload";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000; // fixed epoch ms — no Date() anywhere
const daysAgo = (n: number) => NOW - n * DAY;

const open = (id: string, assignee: string | null, createdDaysAgo = 0): WorkloadTask => ({ id, assignee, status: "next", createdAt: daysAgo(createdDaysAgo) });

test("per-assignee open load, with an unassigned bucket, assignee-sorted", () => {
  const tasks: WorkloadTask[] = [open("1", "ada"), open("2", "ada"), open("3", "bo"), open("4", null)];
  const r = analyzeTaskWorkload(tasks, { now: NOW });
  assert.deepEqual(r.byAssignee.map((a) => [a.assignee, a.openCount]), [["ada", 2], ["bo", 1], ["unassigned", 1]]);
  assert.equal(r.counts.openTotal, 4);
  assert.equal(r.counts.unassignedOpen, 1);
});

test("closed (done/dropped) tasks are excluded from open load", () => {
  const tasks: WorkloadTask[] = [open("1", "ada"), { id: "2", assignee: "ada", status: "done" }, { id: "3", assignee: "ada", status: "dropped" }];
  const r = analyzeTaskWorkload(tasks, { now: NOW });
  assert.equal(r.byAssignee.find((a) => a.assignee === "ada")!.openCount, 1);
  assert.equal(r.counts.closedTotal, 2);
});

test("over-WIP is flagged when open exceeds the limit, with overBy", () => {
  const tasks: WorkloadTask[] = [open("1", "ada"), open("2", "ada"), open("3", "ada")];
  const r = analyzeTaskWorkload(tasks, { now: NOW, wipLimitByAssignee: { ada: 2 } });
  const ada = r.byAssignee.find((a) => a.assignee === "ada")!;
  assert.equal(ada.overWip, true);
  assert.equal(ada.overBy, 1);
  assert.deepEqual(r.overWip.map((a) => a.assignee), ["ada"]);
  assert.equal(r.counts.assigneesOverWip, 1);
});

test("default WIP limit applies to real assignees but not the unassigned bucket", () => {
  const tasks: WorkloadTask[] = [open("1", "ada"), open("2", "ada"), open("3", null), open("4", null), open("5", null)];
  const r = analyzeTaskWorkload(tasks, { now: NOW, defaultWipLimit: 1 });
  assert.equal(r.byAssignee.find((a) => a.assignee === "ada")!.overBy, 1); // 2 > 1
  const unassigned = r.byAssignee.find((a) => a.assignee === "unassigned")!;
  assert.equal(unassigned.wipLimit, null); // no limit on the pseudo-assignee
  assert.equal(unassigned.overWip, false);
});

test("a per-assignee limit overrides the default", () => {
  const tasks: WorkloadTask[] = [open("1", "ada"), open("2", "ada"), open("3", "ada")];
  const r = analyzeTaskWorkload(tasks, { now: NOW, defaultWipLimit: 1, wipLimitByAssignee: { ada: 5 } });
  assert.equal(r.byAssignee.find((a) => a.assignee === "ada")!.overWip, false); // 3 ≤ 5
});

test("overWip list is worst-first (most over the limit)", () => {
  const tasks: WorkloadTask[] = [
    open("1", "ada"), open("2", "ada"), open("3", "ada"), // 3, limit 1 ⇒ over by 2
    open("4", "bo"), open("5", "bo"), // 2, limit 1 ⇒ over by 1
  ];
  const r = analyzeTaskWorkload(tasks, { now: NOW, defaultWipLimit: 1 });
  assert.deepEqual(r.overWip.map((a) => [a.assignee, a.overBy]), [["ada", 2], ["bo", 1]]);
});

test("aging buckets place open tasks by age-since-created", () => {
  const tasks: WorkloadTask[] = [
    open("fresh", "ada", 0), // 0-1d
    open("recent", "ada", 2), // 1-3d
    open("week", "ada", 5), // 3-7d
    open("old", "ada", 45), // 30d+
  ];
  const r = analyzeTaskWorkload(tasks, { now: NOW });
  const byLabel = Object.fromEntries(r.aging.map((b) => [b.label, b.count]));
  assert.equal(byLabel["0-1d"], 1);
  assert.equal(byLabel["1-3d"], 1);
  assert.equal(byLabel["3-7d"], 1);
  assert.equal(byLabel["30d+"], 1);
  assert.equal(r.oldestOpenAgeDays, 45);
});

test("custom aging boundaries build the expected buckets", () => {
  const r = analyzeTaskWorkload([open("1", "ada", 10)], { now: NOW, agingBucketsDays: [7] });
  assert.deepEqual(r.aging.map((b) => b.label), ["0-7d", "7d+"]);
  assert.equal(r.aging.find((b) => b.label === "7d+")!.count, 1);
});

test("open tasks with no usable createdAt are counted as agingUnknown, not bucketed", () => {
  const tasks: WorkloadTask[] = [{ id: "1", assignee: "ada", status: "next" }, { id: "2", assignee: "ada", status: "next", createdAt: NaN as unknown as number }];
  const r = analyzeTaskWorkload(tasks, { now: NOW });
  assert.equal(r.counts.agingUnknown, 2);
  assert.equal(r.aging.reduce((s, b) => s + b.count, 0), 0);
  assert.equal(r.oldestOpenAgeDays, 0);
});

test("empty ⇒ empty", () => {
  const r = analyzeTaskWorkload([], { now: NOW });
  assert.deepEqual(r.byAssignee, []);
  assert.deepEqual(r.overWip, []);
  assert.deepEqual(r.counts, { openTotal: 0, closedTotal: 0, unassignedOpen: 0, assigneesOverWip: 0, agingUnknown: 0 });
  assert.equal(r.oldestOpenAgeDays, 0);
});

test("malformed input is tolerated (never throws); dirty age clamped (no NaN)", () => {
  const tasks = [null, 7, { id: "1", assignee: "ada", status: "next", createdAt: daysAgo(3) }, { id: "2", assignee: "ada", status: "next", createdAt: NOW + 5 * DAY }] as unknown as WorkloadTask[];
  const r = analyzeTaskWorkload(tasks, { now: NOW });
  assert.equal(r.counts.openTotal, 2);
  // future-dated createdAt ⇒ age clamps to 0 (no negative / NaN), lands in the first bucket
  assert.equal(r.aging.find((b) => b.label === "0-1d")!.count, 1);
  assert.ok(Number.isFinite(r.oldestOpenAgeDays));
});

test("deterministic across identical runs", () => {
  const tasks: WorkloadTask[] = [open("1", "ada", 2), open("2", "bo", 9)];
  assert.deepEqual(analyzeTaskWorkload(tasks, { now: NOW, defaultWipLimit: 1 }), analyzeTaskWorkload(tasks, { now: NOW, defaultWipLimit: 1 }));
});
