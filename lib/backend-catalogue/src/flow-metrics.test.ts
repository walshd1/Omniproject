import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFlowMetrics, type FlowItem } from "./flow-metrics";

// Literal epoch-ms (no Date/clock). Four weekly boundaries.
const DAY = 86_400_000;
const T0 = 20_000 * DAY;
const P = [T0, T0 + 7 * DAY, T0 + 14 * DAY, T0 + 21 * DAY]; // 4 period boundaries

// Six items created before the window; completed across the weeks.
const items: FlowItem[] = [
  { id: "a", status: "done", createdAt: T0 - DAY, startedAt: T0 - DAY, completedAt: T0 + 1 * DAY }, // done by P1
  { id: "b", status: "done", createdAt: T0 - DAY, startedAt: T0 - DAY, completedAt: T0 + 8 * DAY }, // done by P2
  { id: "c", status: "done", createdAt: T0 - DAY, startedAt: T0 - DAY, completedAt: T0 + 15 * DAY }, // done by P3
  { id: "d", status: "in_progress", createdAt: T0 - DAY, startedAt: T0 + 2 * DAY }, // active, never done
  { id: "e", status: "todo", createdAt: T0 - DAY }, // backlog throughout
  { id: "f", status: "backlog", createdAt: T0 - DAY }, // backlog throughout
];

test("burn-down: remaining decreases as items complete; ideal line spans opening scope → 0", () => {
  const { points } = computeFlowMetrics(items, { periods: P });
  assert.equal(points.length, 4);
  assert.equal(points[0]!.scope, 6);
  // completions: a by P1, b by P2, c by P3 ⇒ remaining falls 6→5→4→3.
  assert.deepEqual(points.map((p) => p.remaining), [6, 5, 4, 3]);
  // ideal: linear 6 → 0 across 4 boundaries (span 3): 6, 4, 2, 0.
  assert.deepEqual(points.map((p) => p.ideal), [6, 4, 2, 0]);
});

test("burn-up: completed rises; scope is stable when no scope is added", () => {
  const { points } = computeFlowMetrics(items, { periods: P });
  assert.deepEqual(points.map((p) => p.completed), [0, 1, 2, 3]);
  assert.deepEqual(points.map((p) => p.scope), [6, 6, 6, 6]);
});

test("cumulative-flow lanes: backlog / active / done sum to scope each period", () => {
  const { points } = computeFlowMetrics(items, { periods: P });
  for (const p of points) assert.equal(p.backlog + p.active + p.done, p.scope);
  // at P1 (index 1): a done (1); b,c,d active (3); e,f backlog (2).
  assert.equal(points[1]!.done, 1);
  assert.equal(points[1]!.active, 3);
  assert.equal(points[1]!.backlog, 2);
});

test("throughput counts completions within each bucket", () => {
  const { points, summary } = computeFlowMetrics(items, { periods: P });
  // a completes in bucket 1 (+1d ∈ (P0,P1]); b in bucket 2 (+8d); c in bucket 3 (+15d).
  assert.deepEqual(points.map((p) => p.throughput), [0, 1, 1, 1]);
  assert.equal(summary.throughputTotal, 3);
});

test("scope growth is visible on the burn-up (a later-created item lifts scope)", () => {
  const withLate: FlowItem[] = [...items, { id: "g", status: "todo", createdAt: T0 + 10 * DAY }]; // enters at P3
  const { points } = computeFlowMetrics(withLate, { periods: P });
  assert.deepEqual(points.map((p) => p.scope), [6, 6, 7, 7]); // scope rises once g is created
});

test("weightBy points measures work by story points, not item count", () => {
  const pts: FlowItem[] = [
    { id: "a", status: "done", createdAt: T0 - DAY, completedAt: T0 + 1 * DAY, points: 5 },
    { id: "b", status: "todo", createdAt: T0 - DAY, points: 3 },
  ];
  const { points, summary } = computeFlowMetrics(pts, { periods: P, weightBy: "points" });
  assert.equal(points[0]!.scope, 8); // 5 + 3 points
  assert.equal(points[3]!.completed, 5);
  assert.equal(summary.percentComplete, 62.5); // 5/8
});

test("cancelled items leave scope entirely", () => {
  const withCancel: FlowItem[] = [...items, { id: "x", status: "cancelled", createdAt: T0 - DAY }];
  const { points } = computeFlowMetrics(withCancel, { periods: P });
  assert.equal(points[0]!.scope, 6); // x excluded
});

test("empty periods ⇒ empty; empty items ⇒ zeroed series", () => {
  const none = computeFlowMetrics(items, { periods: [] });
  assert.deepEqual(none.points, []);
  assert.equal(none.summary.percentComplete, null);
  const noItems = computeFlowMetrics([], { periods: P });
  assert.equal(noItems.points.length, 4);
  assert.ok(noItems.points.every((p) => p.scope === 0));
  assert.equal(noItems.summary.percentComplete, null);
});

test("malformed input tolerated: non-objects dropped, ids coerced, dirty timestamps/points never throw", () => {
  const dirty = [
    null,
    42,
    { id: "ok", status: "done", createdAt: "not-a-date", completedAt: T0 + DAY }, // dirty createdAt ⇒ in scope throughout
    { id: "  ", status: "done", createdAt: T0 - DAY }, // blank id dropped
    { id: 7, status: "todo", createdAt: T0 - DAY, points: "xyz" }, // numeric id ok; dirty points ⇒ 0
  ] as unknown as FlowItem[];
  const { points } = computeFlowMetrics(dirty, { periods: P, weightBy: "points" });
  // "ok" has dirty createdAt (in scope throughout) but 0 points; "7" has 0 points ⇒ points-scope is 0.
  assert.ok(points.every((p) => Number.isFinite(p.scope)));
  assert.equal(points[0]!.scope, 0); // both surviving items have 0 points
});

test("unsorted / duplicate period boundaries are normalised (sorted + de-duped)", () => {
  const { points } = computeFlowMetrics(items, { periods: [P[3]!, P[0]!, P[0]!, P[1]!, P[2]!] });
  assert.deepEqual(points.map((p) => p.period), P); // sorted ascending, deduped
});

test("deterministic: same input ⇒ identical output", () => {
  const a = computeFlowMetrics(items, { periods: P });
  const b = computeFlowMetrics(items, { periods: P });
  assert.deepEqual(a, b);
});
