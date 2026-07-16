import { describe, it, expect } from "vitest";
import { DEFAULT_WORKING_CALENDAR } from "./working-calendar";
import { computeCascade, type CascadeIssue } from "./cascade-reschedule";
import type { DependencyEdge, DependencyType, ItemRef } from "./dependencies";

/**
 * Drag-a-bar cascade maths. Ruler: 1970-01-01 = day 0 (Thu), 01-02 Fri, 01-05 Mon, 01-06 Tue. Default
 * Mon–Fri calendar; project P. A (Thu–Fri, day 0–1) blocks B (Mon–Tue, day 4–5).
 */
const cal = DEFAULT_WORKING_CALENDAR;
const P = "P";
const ref = (itemRef: string): ItemRef => ({ system: "jira", projectRef: P, itemRef });
const blocks = (from: string, to: string): DependencyEdge => ({
  schema: 1, edgeKey: `${from}-blocks-${to}`, from: ref(from), to: ref(to), type: "blocks" as DependencyType, fromHash: "h", toHash: "h", assertedAt: "1970-01-01T00:00:00Z",
});

const A: CascadeIssue = { id: "A", startDate: "1970-01-01", dueDate: "1970-01-02" }; // day 0–1
const B: CascadeIssue = { id: "B", startDate: "1970-01-05", dueDate: "1970-01-06" }; // day 4–5
const starts = { A: 0, B: 4 };

describe("computeCascade", () => {
  it("dragging a predecessor later pushes the dependent by the same knock-on", () => {
    // A +1 working day (Thu→Fri). A now finishes Mon → B (FS) is pushed from Mon to Tue.
    const shifts = computeCascade(cal, [A, B], [blocks("A", "B")], P, starts, "A", 1);
    expect(shifts.get("A")).toBe(1);
    expect(shifts.get("B")).toBe(1);
  });

  it("dragging a predecessor EARLIER never pulls the dependent (push-only)", () => {
    const shifts = computeCascade(cal, [A, B], [blocks("A", "B")], P, starts, "A", -3);
    expect(shifts.get("A")).toBe(-3);
    expect(shifts.has("B")).toBe(false); // B stays put
  });

  it("dragging the dependent itself moves only it", () => {
    const shifts = computeCascade(cal, [A, B], [blocks("A", "B")], P, starts, "B", 2);
    expect(shifts.has("A")).toBe(false);
    expect(shifts.get("B")).toBe(2);
  });

  it("with no dependency, only the dragged bar moves", () => {
    const shifts = computeCascade(cal, [A, B], [], P, starts, "A", 5);
    expect(shifts.get("A")).toBe(5);
    expect(shifts.has("B")).toBe(false);
  });

  it("a zero drag yields no writes", () => {
    expect(computeCascade(cal, [A, B], [blocks("A", "B")], P, starts, "A", 0).size).toBe(0);
  });

  it("only the knock-on of THIS drag is written, not pre-existing slack", () => {
    // B already sits well after A (day 4 with a 2-day gap); nudging A by 1 keeps A's finish before B's
    // start, so B does NOT move — no spurious write from the baseline.
    const shifts = computeCascade(cal, [A, B], [blocks("A", "B")], P, starts, "A", -1);
    expect(shifts.get("A")).toBe(-1);
    expect(shifts.has("B")).toBe(false);
  });
});
