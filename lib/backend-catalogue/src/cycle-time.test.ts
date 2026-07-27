import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCycleTime, type CycleTimeItem } from "./cycle-time";

const DAY = 86_400_000;
const T0 = 20_000 * DAY;
// A done item created at c, started at s, completed at f (day offsets from T0).
const D = (id: string, c: number, s: number, f: number): CycleTimeItem => ({ id, status: "done", createdAt: T0 + c * DAY, startedAt: T0 + s * DAY, completedAt: T0 + f * DAY });

test("computes cycle time (started→done) and lead time (created→done) in days", () => {
  const { cycleTime, leadTime } = computeCycleTime([D("a", 0, 2, 5)]); // cycle 3d, lead 5d
  assert.equal(cycleTime.count, 1);
  assert.equal(cycleTime.mean, 3);
  assert.equal(leadTime.mean, 5);
});

test("percentiles: p50/p85/p95 over a spread (nearest-rank)", () => {
  // cycle times 1..10 days
  const items = Array.from({ length: 10 }, (_, i) => D(`i${i}`, 0, 0, i + 1));
  const { cycleTime } = computeCycleTime(items);
  assert.equal(cycleTime.count, 10);
  assert.equal(cycleTime.min, 1);
  assert.equal(cycleTime.max, 10);
  assert.equal(cycleTime.median, 5); // nearest-rank floor(0.5*9)=4 ⇒ sorted[4]=5
  assert.equal(cycleTime.p85, 8); // floor(0.85*9)=7 ⇒ sorted[7]=8
  assert.equal(cycleTime.p95, 9); // floor(0.95*9)=8 ⇒ sorted[8]=9
});

test("only done items count; non-done are ignored", () => {
  const items: CycleTimeItem[] = [D("done", 0, 1, 4), { id: "wip", status: "in_progress", createdAt: T0, startedAt: T0 + DAY }];
  const { cycleTime, doneItems } = computeCycleTime(items);
  assert.equal(doneItems, 1);
  assert.equal(cycleTime.count, 1);
});

test("a done item missing startedAt still contributes lead time, not cycle time", () => {
  const items: CycleTimeItem[] = [{ id: "a", status: "done", createdAt: T0, completedAt: T0 + 4 * DAY }];
  const { cycleTime, leadTime, doneItems } = computeCycleTime(items);
  assert.equal(doneItems, 1);
  assert.equal(cycleTime.count, 0); // no startedAt ⇒ no cycle time
  assert.equal(leadTime.count, 1);
  assert.equal(leadTime.mean, 4);
});

test("a negative span (started after completed / dirty order) clamps to 0", () => {
  const { cycleTime } = computeCycleTime([{ id: "a", status: "done", startedAt: T0 + 5 * DAY, completedAt: T0 + 2 * DAY }]);
  assert.equal(cycleTime.mean, 0); // max(0, negative)
});

test("stdDev is the population standard deviation", () => {
  const { cycleTime } = computeCycleTime([D("a", 0, 0, 2), D("b", 0, 0, 6)]); // cycle times 2, 6 ⇒ mean 4, stddev 2
  assert.equal(cycleTime.mean, 4);
  assert.equal(cycleTime.stdDev, 2);
});

test("empty ⇒ zero-count distributions with null stats", () => {
  const r = computeCycleTime([]);
  assert.deepEqual(r.cycleTime, { count: 0, mean: null, median: null, p50: null, p85: null, p95: null, min: null, max: null, stdDev: null });
  assert.equal(r.doneItems, 0);
});

test("a done item with no completedAt can't be timed", () => {
  const r = computeCycleTime([{ id: "a", status: "done", startedAt: T0 }]);
  assert.equal(r.doneItems, 0);
  assert.equal(r.cycleTime.count, 0);
});

test("malformed input tolerated: non-objects dropped, ids coerced, dirty timestamps never throw", () => {
  const dirty = [
    null,
    42,
    { id: 7, status: "done", startedAt: "nope", completedAt: T0 + 3 * DAY }, // dirty startedAt ⇒ no cycle
    { id: "  ", status: "done", completedAt: T0 }, // blank id dropped
    { id: "ok", status: "done", createdAt: T0, startedAt: T0 + DAY, completedAt: T0 + 3 * DAY },
  ] as unknown as CycleTimeItem[];
  const { cycleTime, leadTime, doneItems } = computeCycleTime(dirty);
  assert.equal(doneItems, 2); // "7" and "ok"
  assert.equal(cycleTime.count, 1); // only "ok" has a usable startedAt
  assert.ok(leadTime.mean !== null && Number.isFinite(leadTime.mean));
});

test("deterministic: same input ⇒ identical output", () => {
  const items = [D("a", 0, 1, 5), D("b", 0, 2, 4), D("c", 0, 0, 9)];
  assert.deepEqual(computeCycleTime(items), computeCycleTime(items));
});
