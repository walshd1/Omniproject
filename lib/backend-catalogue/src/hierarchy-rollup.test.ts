import { test } from "node:test";
import assert from "node:assert/strict";
import { rollUpHierarchy, type HierarchyItem } from "./hierarchy-rollup";

const node = (id: string, parentId?: string, extra: Partial<HierarchyItem> = {}): HierarchyItem => ({ id, ...(parentId ? { parentId } : {}), ...extra });

test("a parent's progress is the weighted mean of its children", () => {
  const items: HierarchyItem[] = [
    node("epic"),
    node("s1", "epic", { status: "done" }), // 1.0
    node("s2", "epic", { progress: 0.5 }), // 0.5
  ];
  const { nodes } = rollUpHierarchy(items);
  const epic = nodes.find((n) => n.id === "epic")!;
  assert.equal(epic.rolledProgress, 0.75); // (1 + 0.5) / 2
  assert.equal(epic.isLeaf, false);
  assert.equal(epic.childCount, 2);
});

test("weights (story points) skew the mean", () => {
  const items: HierarchyItem[] = [
    node("epic"),
    node("big", "epic", { progress: 1, weight: 3 }),
    node("small", "epic", { progress: 0, weight: 1 }),
  ];
  const epic = rollUpHierarchy(items).nodes.find((n) => n.id === "epic")!;
  assert.equal(epic.rolledProgress, 0.75); // (1*3 + 0*1) / 4
});

test("rolls up recursively through multiple levels", () => {
  const items: HierarchyItem[] = [
    node("epic"),
    node("story", "epic"),
    node("t1", "story", { status: "done" }),
    node("t2", "story", { status: "todo" }),
  ];
  const { nodes, summary } = rollUpHierarchy(items);
  assert.equal(nodes.find((n) => n.id === "story")!.rolledProgress, 0.5);
  assert.equal(nodes.find((n) => n.id === "epic")!.rolledProgress, 0.5);
  assert.equal(summary.maxDepth, 2); // epic(0) → story(1) → task(2)
});

test("a cancelled leaf is excluded from its parent's weight", () => {
  const items: HierarchyItem[] = [
    node("epic"),
    node("done", "epic", { status: "done" }),
    node("cancelled", "epic", { status: "cancelled", progress: 0 }),
  ];
  // only the done child counts ⇒ epic is 1.0, not 0.5
  assert.equal(rollUpHierarchy(items).nodes.find((n) => n.id === "epic")!.rolledProgress, 1);
});

test("descendant counts + done descendants", () => {
  const items: HierarchyItem[] = [
    node("epic"),
    node("s1", "epic", { status: "done" }),
    node("s2", "epic"),
    node("t", "s2", { status: "done" }),
  ];
  const epic = rollUpHierarchy(items).nodes.find((n) => n.id === "epic")!;
  assert.equal(epic.descendantCount, 3); // s1, s2, t
  assert.equal(epic.doneDescendants, 3); // s1=1, t=1, and s2 rolls to 1 via t
});

test("roots + overall progress across roots (weighted)", () => {
  const items: HierarchyItem[] = [
    node("e1", undefined, { progress: 1, weight: 1 }),
    node("e2", undefined, { progress: 0, weight: 1 }),
  ];
  const { roots, summary } = rollUpHierarchy(items);
  assert.deepEqual(roots, ["e1", "e2"]);
  assert.equal(summary.roots, 2);
  assert.equal(summary.overallProgress, 0.5);
});

test("an unknown or self parentId is treated as a root", () => {
  const items: HierarchyItem[] = [node("a", "ghost", { progress: 0.4 }), node("b", "b", { progress: 0.6 })];
  const { roots, nodes } = rollUpHierarchy(items);
  assert.deepEqual(roots, ["a", "b"]);
  assert.equal(nodes.find((n) => n.id === "a")!.parentId, null);
});

test("cycles are broken, never loop or throw", () => {
  const items: HierarchyItem[] = [node("a", "b", { progress: 0.5 }), node("b", "a", { progress: 0.5 })];
  const r = rollUpHierarchy(items); // a↔b cycle
  assert.ok(r.nodes.every((n) => Number.isFinite(n.rolledProgress)));
  assert.equal(r.nodes.length, 2);
});

test("explicit progress is clamped to [0,1]", () => {
  const items: HierarchyItem[] = [node("a", undefined, { progress: 5 }), node("b", undefined, { progress: -3 })];
  const nodes = rollUpHierarchy(items).nodes;
  assert.equal(nodes.find((n) => n.id === "a")!.ownProgress, 1);
  assert.equal(nodes.find((n) => n.id === "b")!.ownProgress, 0);
});

test("empty ⇒ empty", () => {
  const r = rollUpHierarchy([]);
  assert.deepEqual(r.nodes, []);
  assert.deepEqual(r.roots, []);
  assert.deepEqual(r.summary, { total: 0, roots: 0, maxDepth: 0, overallProgress: null });
});

test("malformed input tolerated: non-objects dropped, ids coerced, never throws", () => {
  const dirty = [
    null,
    42,
    { id: 7, progress: "xyz" }, // numeric id; dirty progress ⇒ 0
    { id: "  ", progress: 1 }, // blank id dropped
    { id: "c", parentId: 7, status: "done" }, // parent "7" exists
  ] as unknown as HierarchyItem[];
  const { nodes, roots } = rollUpHierarchy(dirty);
  assert.equal(nodes.length, 2); // "7" and "c"
  assert.deepEqual(roots, ["7"]);
  assert.equal(nodes.find((n) => n.id === "7")!.rolledProgress, 1); // rolls up its done child "c"
});

test("deterministic: same input ⇒ identical output", () => {
  const items: HierarchyItem[] = [node("e"), node("a", "e", { status: "done" }), node("b", "e", { progress: 0.3 })];
  assert.deepEqual(rollUpHierarchy(items), rollUpHierarchy(items));
});
