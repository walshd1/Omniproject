import { describe, it, expect } from "vitest";
import { DEFAULT_WORKING_CALENDAR } from "./working-calendar";
import { computeProjectForecast, resolveProjectStartDay, type ForecastIssue } from "./project-forecast";
import type { DependencyEdge, DependencyType, ItemRef } from "./dependencies";

/**
 * The pure project-forecast glue. Ruler: 1970-01-01 = day 0 (Thu), 01-02 Fri, 01-05 Mon, 01-06 Tue,
 * 01-07 Wed, 01-08 Thu. Default Mon–Fri calendar; project P.
 */
const cal = DEFAULT_WORKING_CALENDAR;
const P = "P";
const ref = (itemRef: string): ItemRef => ({ system: "jira", projectRef: P, itemRef });
const blocks = (from: string, to: string): DependencyEdge => ({
  schema: 1, edgeKey: `${from}-blocks-${to}`, from: ref(from), to: ref(to), type: "blocks" as DependencyType, fromHash: "h", toHash: "h", assertedAt: "1970-01-01T00:00:00Z",
});

describe("resolveProjectStartDay", () => {
  it("picks the earliest anchored start, else the now fallback", () => {
    expect(resolveProjectStartDay([{ earliestStartDay: 9 }, { earliestStartDay: 4 }], 100)).toBe(4);
    expect(resolveProjectStartDay([{}, {}], 100)).toBe(100);
  });
});

describe("computeProjectForecast", () => {
  const issues: ForecastIssue[] = [
    { id: "A", title: "Design", startDate: "1970-01-01", dueDate: "1970-01-02" }, // Thu–Fri, 2 wd
    { id: "B", title: "Build", startDate: "1970-01-01", dueDate: "1970-01-05" }, // duration 2 wd (Fri+Mon after snap? see below)
  ];

  it("cascades B after A across the weekend and rolls up the project range", () => {
    const { result, rows } = computeProjectForecast(cal, issues, [blocks("A", "B")], P, 4);
    // A: Thu(0)–Fri(1). B is FS after A → starts Mon(4).
    expect(result.tasks["A"]).toMatchObject({ startDay: 0, finishDay: 1 });
    expect(result.tasks["B"]!.startDay).toBe(4);
    expect(result.tasks["B"]!.driverId).toBe("A");
    expect(result.projectStartDay).toBe(0);
    // rows are sorted earliest-start first, and carry titles.
    expect(rows.map((r) => r.title)).toEqual(["Design", "Build"]);
    expect(result.hasCycle).toBe(false);
  });

  it("with no dependencies each task sits at its own anchored start", () => {
    const { result } = computeProjectForecast(cal, issues, [], P, 4);
    expect(result.tasks["A"]!.startDay).toBe(0);
    expect(result.tasks["B"]!.startDay).toBe(0);
  });

  it("surfaces a constraint violation via the opts passthrough", () => {
    const { result } = computeProjectForecast(cal, issues, [blocks("A", "B")], P, 4, {
      constraints: { B: { kind: "FNLT", day: 1 } }, // B must finish ≤ Fri, but is pushed to Mon+
    });
    expect(result.violations).toContain("B");
  });
});
