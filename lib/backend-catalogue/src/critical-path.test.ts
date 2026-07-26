import { test } from "node:test";
import assert from "node:assert/strict";
import { criticalPath, type CpmNode, type CpmEdge } from "./critical-path";

/**
 * Critical Path Method: forward/backward pass, total float, and the critical set. Canonical
 * networks (linear chain, parallel branches, diamond) plus the robustness edges — cycles,
 * ghost edges, negative durations — that must degrade gracefully rather than hang or throw.
 */

test("schedules a linear chain with every activity critical", () => {
  const nodes: CpmNode[] = [
    { id: "a", duration: 3 },
    { id: "b", duration: 2 },
    { id: "c", duration: 4 },
  ];
  const edges: CpmEdge[] = [{ from: "a", to: "b" }, { from: "b", to: "c" }];
  const r = criticalPath(nodes, edges);
  assert.equal(r.projectDuration, 9);
  assert.deepEqual(r.criticalPath, ["a", "b", "c"]);
  assert.equal(r.nodes.a!.float, 0);
  assert.equal(r.nodes.b!.es, 3); // waits for a's EF
  assert.equal(r.nodes.c!.ef, 9);
  assert.equal(r.hasCycle, false);
});

test("finds float on the shorter parallel branch and keeps the longer one critical", () => {
  // a(2) ─┐            b(5) is the long pole into c(1)
  // b(5) ─┴─> c(1)
  const nodes: CpmNode[] = [
    { id: "a", duration: 2 },
    { id: "b", duration: 5 },
    { id: "c", duration: 1 },
  ];
  const edges: CpmEdge[] = [{ from: "a", to: "c" }, { from: "b", to: "c" }];
  const r = criticalPath(nodes, edges);
  assert.equal(r.projectDuration, 6); // 5 + 1
  assert.equal(r.nodes.c!.es, 5); // waits for the longer predecessor
  assert.equal(r.nodes.b!.critical, true);
  assert.equal(r.nodes.a!.critical, false);
  assert.equal(r.nodes.a!.float, 3); // 5 − 2
  assert.deepEqual(r.criticalPath, ["b", "c"]);
});

test("treats an isolated activity (no edges) as critical when it sets the duration", () => {
  const r = criticalPath([{ id: "solo", duration: 7 }], []);
  assert.equal(r.projectDuration, 7);
  assert.equal(r.nodes.solo!.critical, true);
  assert.equal(r.nodes.solo!.float, 0);
});

test("detects a cycle and reports the unscheduled activities instead of hanging", () => {
  const nodes: CpmNode[] = [
    { id: "a", duration: 1 },
    { id: "b", duration: 1 },
    { id: "ok", duration: 2 },
  ];
  const edges: CpmEdge[] = [{ from: "a", to: "b" }, { from: "b", to: "a" }];
  const r = criticalPath(nodes, edges);
  assert.equal(r.hasCycle, true);
  assert.deepEqual([...r.unscheduled].sort(), ["a", "b"]);
  // The acyclic remainder still schedules.
  assert.equal(r.nodes.ok!.critical, true);
});

test("ignores edges referencing unknown activities and clamps negative durations", () => {
  const nodes: CpmNode[] = [{ id: "a", duration: -5 }, { id: "b", duration: 4 }];
  const edges: CpmEdge[] = [{ from: "a", to: "b" }, { from: "ghost", to: "b" }, { from: "a", to: "a" }];
  const r = criticalPath(nodes, edges);
  assert.equal(r.nodes.a!.duration, 0); // clamped
  assert.equal(r.projectDuration, 4);
  assert.equal(r.hasCycle, false); // self-loop ignored, ghost ignored
});

test("computes a diamond's float correctly", () => {
  // a(2) -> {b(4), c(1)} -> d(3); path a-b-d = 9 critical, c floats.
  const nodes: CpmNode[] = [
    { id: "a", duration: 2 },
    { id: "b", duration: 4 },
    { id: "c", duration: 1 },
    { id: "d", duration: 3 },
  ];
  const edges: CpmEdge[] = [
    { from: "a", to: "b" }, { from: "a", to: "c" },
    { from: "b", to: "d" }, { from: "c", to: "d" },
  ];
  const r = criticalPath(nodes, edges);
  assert.equal(r.projectDuration, 9);
  assert.deepEqual(r.criticalPath, ["a", "b", "d"]);
  assert.equal(r.nodes.c!.float, 3); // b is 3 longer than c
  // Latest start/finish on the floating activity confirms the backward pass.
  assert.equal(r.nodes.c!.ls, 5); // can start 3 late (a ends at 2, d needs it by 6)
  assert.equal(r.nodes.d!.critical, true);
});

test("empty network yields a zero-duration schedule with no critical path", () => {
  const r = criticalPath([], []);
  assert.equal(r.projectDuration, 0);
  assert.deepEqual(r.criticalPath, []);
  assert.deepEqual(r.order, []);
  assert.equal(r.hasCycle, false);
});
