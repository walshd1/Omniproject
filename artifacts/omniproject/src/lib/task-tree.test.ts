import { describe, it, expect } from "vitest";
import { buildTaskTree, flattenTaskTree, type TreeTask } from "./task-tree";

const ids = (rows: Array<{ task: { id: string } }>) => rows.map((r) => r.task.id);

describe("task-tree", () => {
  const tasks: TreeTask[] = [
    { id: "a" },
    { id: "a1", parentTaskId: "a", sortOrder: 2 },
    { id: "a2", parentTaskId: "a", sortOrder: 1 },
    { id: "a1x", parentTaskId: "a1" },
    { id: "b" },
  ];

  it("nests children under parents, ordered by sortOrder, with depth stamped", () => {
    const roots = buildTaskTree(tasks);
    expect(roots.map((r) => r.task.id)).toEqual(["a", "b"]);
    expect(roots[0]!.children.map((c) => c.task.id)).toEqual(["a2", "a1"]); // sortOrder 1 before 2
    expect(roots[0]!.children[1]!.children[0]!.task.id).toBe("a1x");
    expect(roots[0]!.children[1]!.children[0]!.depth).toBe(2);
  });

  it("flattens to visible rows depth-first, skipping folded subtrees", () => {
    const roots = buildTaskTree(tasks);
    expect(ids(flattenTaskTree(roots))).toEqual(["a", "a2", "a1", "a1x", "b"]);
    // Fold "a1" → its child a1x disappears, but a1 itself and its sibling stay.
    expect(ids(flattenTaskTree(roots, new Set(["a1"])))).toEqual(["a", "a2", "a1", "b"]);
    // hasChildren drives the caret.
    const flat = flattenTaskTree(roots);
    expect(flat.find((r) => r.task.id === "a")!.hasChildren).toBe(true);
    expect(flat.find((r) => r.task.id === "b")!.hasChildren).toBe(false);
  });

  it("a missing parent makes the task a root (never dropped)", () => {
    const roots = buildTaskTree([{ id: "x", parentTaskId: "ghost" }, { id: "y" }]);
    expect(roots.map((r) => r.task.id).sort()).toEqual(["x", "y"]);
  });

  it("a parent cycle is broken so every task still renders exactly once", () => {
    const cyclic: TreeTask[] = [{ id: "p", parentTaskId: "q" }, { id: "q", parentTaskId: "p" }];
    const roots = buildTaskTree(cyclic);
    const all = flattenTaskTree(roots);
    expect(all.map((r) => r.task.id).sort()).toEqual(["p", "q"]);
    expect(all).toHaveLength(2); // no duplication, no infinite loop
  });
});
