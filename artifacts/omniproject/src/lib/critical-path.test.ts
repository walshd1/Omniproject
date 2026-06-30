import { describe, it, expect } from "vitest";
import { criticalPath, type CpmNode, type CpmEdge } from "./critical-path";

describe("criticalPath", () => {
  it("schedules a linear chain with every activity critical", () => {
    const nodes: CpmNode[] = [
      { id: "a", duration: 3 },
      { id: "b", duration: 2 },
      { id: "c", duration: 4 },
    ];
    const edges: CpmEdge[] = [{ from: "a", to: "b" }, { from: "b", to: "c" }];
    const r = criticalPath(nodes, edges);
    expect(r.projectDuration).toBe(9);
    expect(r.criticalPath).toEqual(["a", "b", "c"]);
    expect(r.nodes.a!.float).toBe(0);
    expect(r.nodes.b!.es).toBe(3);
    expect(r.nodes.c!.ef).toBe(9);
    expect(r.hasCycle).toBe(false);
  });

  it("finds float on the shorter parallel branch and keeps the longer one critical", () => {
    // a(2) ─┐            b(5) is the long pole into c(1)
    // b(5) ─┴─> c(1)
    const nodes: CpmNode[] = [
      { id: "a", duration: 2 },
      { id: "b", duration: 5 },
      { id: "c", duration: 1 },
    ];
    const edges: CpmEdge[] = [{ from: "a", to: "c" }, { from: "b", to: "c" }];
    const r = criticalPath(nodes, edges);
    expect(r.projectDuration).toBe(6); // 5 + 1
    expect(r.nodes.c!.es).toBe(5); // waits for the longer predecessor
    expect(r.nodes.b!.critical).toBe(true);
    expect(r.nodes.a!.critical).toBe(false);
    expect(r.nodes.a!.float).toBe(3); // 5 − 2
    expect(r.criticalPath).toEqual(["b", "c"]);
  });

  it("treats an isolated activity (no edges) as critical when it sets the duration", () => {
    const r = criticalPath([{ id: "solo", duration: 7 }], []);
    expect(r.projectDuration).toBe(7);
    expect(r.nodes.solo!.critical).toBe(true);
    expect(r.nodes.solo!.float).toBe(0);
  });

  it("detects a cycle and reports the unscheduled activities instead of hanging", () => {
    const nodes: CpmNode[] = [
      { id: "a", duration: 1 },
      { id: "b", duration: 1 },
      { id: "ok", duration: 2 },
    ];
    const edges: CpmEdge[] = [{ from: "a", to: "b" }, { from: "b", to: "a" }];
    const r = criticalPath(nodes, edges);
    expect(r.hasCycle).toBe(true);
    expect(r.unscheduled.sort()).toEqual(["a", "b"]);
    // The acyclic remainder still schedules.
    expect(r.nodes.ok!.critical).toBe(true);
  });

  it("ignores edges referencing unknown activities and clamps negative durations", () => {
    const nodes: CpmNode[] = [{ id: "a", duration: -5 }, { id: "b", duration: 4 }];
    const edges: CpmEdge[] = [{ from: "a", to: "b" }, { from: "ghost", to: "b" }, { from: "a", to: "a" }];
    const r = criticalPath(nodes, edges);
    expect(r.nodes.a!.duration).toBe(0); // clamped
    expect(r.projectDuration).toBe(4);
    expect(r.hasCycle).toBe(false); // self-loop ignored, ghost ignored
  });

  it("computes a diamond's float correctly", () => {
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
    expect(r.projectDuration).toBe(9);
    expect(r.criticalPath).toEqual(["a", "b", "d"]);
    expect(r.nodes.c!.float).toBe(3); // b is 3 longer than c
  });
});
