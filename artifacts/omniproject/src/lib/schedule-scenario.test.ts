import { describe, it, expect } from "vitest";
import { buildScheduleItems, computeSchedule, type ScheduleInput, type DepEdge } from "./schedule-scenario";

// Three packages, 10 days apart, A→B→C chained back-to-back (each 4 days).
//   A: day 0..4   B: day 5..9   C: day 10..14
const D = (day: number) => new Date(day * 86400000).toISOString();
const inputs: ScheduleInput[] = [
  { id: "A", title: "Foundations", status: "in_progress", startDate: D(0), dueDate: D(4) },
  { id: "B", title: "Walls", status: "todo", startDate: D(5), dueDate: D(9) },
  { id: "C", title: "Roof", status: "todo", startDate: D(10), dueDate: D(14) },
];
const chain: DepEdge[] = [
  { predecessorId: "A", successorId: "B" },
  { predecessorId: "B", successorId: "C" },
];

const find = (r: { items: { id: string }[] }, id: string) =>
  r.items.find((i) => i.id === id) as (typeof r.items)[number] & Record<string, number | boolean>;

describe("buildScheduleItems", () => {
  it("drops issues with no dates and derives duration", () => {
    const items = buildScheduleItems([...inputs, { id: "X", title: "n/a", status: "todo" }]);
    expect(items.map((i) => i.id)).toEqual(["A", "B", "C"]);
    expect(items[0].durationDays).toBe(4);
  });

  it("treats a single date as a zero-duration milestone", () => {
    const [m] = buildScheduleItems([{ id: "M", title: "Gate", status: "todo", dueDate: D(7) }]);
    expect(m.durationDays).toBe(0);
    expect(m.baseStartDay).toBe(m.baseEndDay);
  });
});

describe("computeSchedule — no shift", () => {
  it("is a no-op when nothing is moved", () => {
    const items = buildScheduleItems(inputs);
    const r = computeSchedule(items, chain, {});
    expect(r.summary.affectedCount).toBe(0);
    expect(r.summary.projectEndDeltaDays).toBe(0);
    expect(find(r, "A").totalShiftDays).toBe(0);
  });
});

describe("computeSchedule — knock-ons", () => {
  it("cascades a delay down the dependency chain", () => {
    const items = buildScheduleItems(inputs);
    // Start A 6 days later: A 6..10. B can't start before A ends (10), C after B.
    const r = computeSchedule(items, chain, { A: 6 });
    expect(find(r, "A").resolvedStartDay).toBe(6); // A: 6..10
    expect(find(r, "B").resolvedStartDay).toBe(10); // pushed to A's finish: 10..14
    expect(find(r, "C").resolvedStartDay).toBe(14); // pushed to B's finish: 14..18
    expect(find(r, "B").movedByCascade).toBe(true);
    expect(find(r, "B").movedByUser).toBe(false);
    expect(r.summary.directlyMovedCount).toBe(1);
    expect(r.summary.knockOnCount).toBe(2);
    expect(r.summary.projectEndDeltaDays).toBe(4); // C end 14 -> 18
  });

  it("does not pull successors earlier than their own dates when slack exists", () => {
    const items = buildScheduleItems(inputs);
    // Nudge A only 1 day: A ends at 5, B already starts at 5 — no push.
    const r = computeSchedule(items, chain, { A: 1 });
    expect(find(r, "B").resolvedStartDay).toBe(5);
    expect(find(r, "B").movedByCascade).toBe(false);
    expect(r.summary.knockOnCount).toBe(0);
  });

  it("flags a newly-breached deadline", () => {
    const items = buildScheduleItems(inputs);
    const r = computeSchedule(items, chain, { C: 3 }); // C due day 14, now ends 17
    expect(find(r, "C").breached).toBe(true);
    expect(find(r, "C").newlyBreached).toBe(true);
    expect(r.summary.newBreachCount).toBe(1);
  });
});

describe("computeSchedule — robustness", () => {
  it("ignores edges to unknown nodes and self-loops", () => {
    const items = buildScheduleItems(inputs);
    const r = computeSchedule(items, [{ predecessorId: "A", successorId: "A" }, { predecessorId: "Z", successorId: "B" }], { A: 6 });
    expect(find(r, "B").resolvedStartDay).toBe(5); // unaffected — no valid edge
    expect(r.summary.hasCycle).toBe(false);
  });

  it("flags a cycle and still returns a result", () => {
    const items = buildScheduleItems(inputs);
    const cyclic: DepEdge[] = [
      { predecessorId: "A", successorId: "B" },
      { predecessorId: "B", successorId: "A" },
    ];
    const r = computeSchedule(items, cyclic, { A: 2 });
    expect(r.summary.hasCycle).toBe(true);
    expect(r.items).toHaveLength(3);
  });

  it("does not mutate inputs", () => {
    const items = buildScheduleItems(inputs);
    const snap = JSON.stringify(items);
    computeSchedule(items, chain, { A: 6 });
    expect(JSON.stringify(items)).toBe(snap);
  });
});
