import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTaskDependencies, type DependencyTask, type TaskDependencyEdge } from "./task-dependencies";

// GTD canonical statuses: next (actionable/open), done + dropped (closed).
const open = (id: string): DependencyTask => ({ id, status: "next" });
const done = (id: string): DependencyTask => ({ id, status: "done" });

test("a task with no blockers is ready", () => {
  const r = resolveTaskDependencies([open("a")], []);
  assert.equal(r.nodes["a"]!.readiness, "ready");
  assert.deepEqual(r.readyNow, ["a"]);
  assert.deepEqual(r.blocked, []);
});

test("a task blocked by an open task is blocked; the blocker is ready", () => {
  const r = resolveTaskDependencies([open("a"), open("b")], [{ taskId: "b", blockedBy: "a" }]);
  assert.equal(r.nodes["a"]!.readiness, "ready");
  assert.equal(r.nodes["b"]!.readiness, "blocked");
  assert.deepEqual(r.nodes["b"]!.blockedBy, ["a"]);
  assert.deepEqual(r.nodes["a"]!.blocks, ["b"]);
  assert.deepEqual(r.readyNow, ["a"]);
  assert.deepEqual(r.blocked, ["b"]);
});

test("a closed blocker is satisfied — the blocked task becomes ready", () => {
  const r = resolveTaskDependencies([done("a"), open("b")], [{ taskId: "b", blockedBy: "a" }]);
  assert.equal(r.nodes["a"]!.readiness, "closed");
  assert.equal(r.nodes["b"]!.readiness, "ready");
  assert.deepEqual(r.nodes["b"]!.blockedBy, []); // the closed edge is not a live blocker
  assert.deepEqual(r.readyNow, ["b"]);
});

test("a dropped blocker also satisfies (closed = done OR dropped)", () => {
  const r = resolveTaskDependencies([{ id: "a", status: "dropped" }, open("b")], [{ taskId: "b", blockedBy: "a" }]);
  assert.equal(r.nodes["b"]!.readiness, "ready");
});

test("a chain a→b→c reports depth and the longest chain", () => {
  const tasks = [open("a"), open("b"), open("c")];
  const edges: TaskDependencyEdge[] = [
    { taskId: "b", blockedBy: "a" },
    { taskId: "c", blockedBy: "b" },
  ];
  const r = resolveTaskDependencies(tasks, edges);
  assert.equal(r.nodes["a"]!.depth, 0);
  assert.equal(r.nodes["b"]!.depth, 1);
  assert.equal(r.nodes["c"]!.depth, 2);
  assert.deepEqual(r.longestChain, ["a", "b", "c"]);
  assert.deepEqual(r.readyNow, ["a"]);
  assert.deepEqual(r.order, ["a", "b", "c"]);
});

test("a two-task deadlock cycle is detected; both are blocked and never ready", () => {
  const r = resolveTaskDependencies([open("a"), open("b")], [
    { taskId: "a", blockedBy: "b" },
    { taskId: "b", blockedBy: "a" },
  ]);
  assert.equal(r.hasCycle, true);
  assert.deepEqual(r.cycles, ["a", "b"]);
  assert.equal(r.nodes["a"]!.inCycle, true);
  assert.equal(r.nodes["b"]!.inCycle, true);
  assert.equal(r.nodes["a"]!.readiness, "blocked");
  assert.deepEqual(r.readyNow, []);
});

test("a task downstream of a cycle cannot proceed either", () => {
  const r = resolveTaskDependencies([open("a"), open("b"), open("c")], [
    { taskId: "a", blockedBy: "b" },
    { taskId: "b", blockedBy: "a" },
    { taskId: "c", blockedBy: "a" }, // c depends on a cyclic node
  ]);
  assert.equal(r.hasCycle, true);
  assert.deepEqual(r.cycles, ["a", "b", "c"]);
  assert.equal(r.nodes["c"]!.readiness, "blocked");
});

test("counts tally ready / blocked / closed / cyclic", () => {
  const r = resolveTaskDependencies(
    [open("a"), open("b"), done("c"), open("d"), open("e")],
    [
      { taskId: "b", blockedBy: "a" }, // b blocked by open a
      { taskId: "d", blockedBy: "e" }, // d↔e cycle
      { taskId: "e", blockedBy: "d" },
    ],
  );
  // ready: a ; blocked: b, d, e ; closed: c ; cyclic: d, e
  assert.equal(r.counts.ready, 1);
  assert.equal(r.counts.blocked, 3);
  assert.equal(r.counts.closed, 1);
  assert.equal(r.counts.cyclic, 2);
});

test("edges to unknown tasks and self-edges are ignored", () => {
  const r = resolveTaskDependencies([open("a")], [
    { taskId: "a", blockedBy: "ghost" }, // unknown blocker
    { taskId: "a", blockedBy: "a" }, // self edge
  ]);
  assert.equal(r.nodes["a"]!.readiness, "ready");
  assert.deepEqual(r.nodes["a"]!.blockedBy, []);
});

test("empty ⇒ empty", () => {
  const r = resolveTaskDependencies([], []);
  assert.deepEqual(r.readyNow, []);
  assert.deepEqual(r.blocked, []);
  assert.deepEqual(r.order, []);
  assert.deepEqual(r.cycles, []);
  assert.equal(r.hasCycle, false);
  assert.deepEqual(r.longestChain, []);
  assert.deepEqual(r.counts, { ready: 0, blocked: 0, closed: 0, cyclic: 0 });
});

test("malformed input is tolerated (never throws); ids coerced; dupes ignored", () => {
  const tasks = [null, 7, { id: "a", status: "next" }, { id: "a", status: "done" }] as unknown as DependencyTask[];
  const edges = [null, { taskId: "a" }, { taskId: 1, blockedBy: 2 }] as unknown as TaskDependencyEdge[];
  const r = resolveTaskDependencies(tasks, edges);
  // first "a" (open) wins over the later duplicate; numeric-id edge references unknown tasks ⇒ ignored
  assert.equal(r.nodes["a"]!.status, "next");
  assert.equal(r.nodes["a"]!.readiness, "ready");
});

test("deterministic across identical runs", () => {
  const tasks = [open("x"), open("y"), open("z")];
  const edges = [{ taskId: "y", blockedBy: "x" }, { taskId: "z", blockedBy: "x" }];
  assert.deepEqual(resolveTaskDependencies(tasks, edges), resolveTaskDependencies(tasks, edges));
});
