import { describe, it, expect } from "vitest";
import { DEFAULT_WORKING_CALENDAR } from "./working-calendar";
import { issueDurationWorkingDays, issuesToScheduleTasks, dependencyEdgesToTyped, type ScheduleIssue } from "./schedule-adapter";
import type { DependencyEdge, DependencyType, ItemRef } from "./dependencies";

/**
 * The adapter that turns live issues + the dependency overlay into auto-scheduler inputs. Dates use the
 * shared ruler: 1970-01-01 = day 0 (Thu), 01-02 Fri, 01-05 Mon, 01-06 Tue. Default Mon–Fri calendar.
 */
const cal = DEFAULT_WORKING_CALENDAR;
const THU = 0, FRI = 1, MON = 4, TUE = 5;

const ref = (system: string, projectRef: string, itemRef: string): ItemRef => ({ system, projectRef, itemRef });
const edge = (from: ItemRef, to: ItemRef, type: DependencyType): DependencyEdge => ({
  schema: 1, edgeKey: `${from.itemRef}-${type}-${to.itemRef}`, from, to, type, fromHash: "h", toHash: "h", assertedAt: "1970-01-01T00:00:00Z",
});

describe("issueDurationWorkingDays", () => {
  it("counts the inclusive start→due span in WORKING days (weekends excluded)", () => {
    expect(issueDurationWorkingDays(cal, { id: "a", startDate: "1970-01-01", dueDate: "1970-01-02" } as ScheduleIssue)).toBe(2); // Thu–Fri
    expect(issueDurationWorkingDays(cal, { id: "b", startDate: "1970-01-02", dueDate: "1970-01-05" } as ScheduleIssue)).toBe(2); // Fri + Mon (Sat/Sun skipped)
  });
  it("falls back to estimate ÷ 8h, then to a 0-day milestone", () => {
    expect(issueDurationWorkingDays(cal, { id: "c", estimateHours: 24 } as ScheduleIssue)).toBe(3);
    expect(issueDurationWorkingDays(cal, { id: "d" } as ScheduleIssue)).toBe(0);
  });
});

describe("issuesToScheduleTasks", () => {
  it("anchors earliestStartDay to the issue start (snapped), attaches constraints, omits when absent", () => {
    const tasks = issuesToScheduleTasks(
      cal,
      [
        { id: "a", startDate: "1970-01-02", dueDate: "1970-01-02" } as ScheduleIssue, // Fri
        { id: "b", startDate: "1970-01-04" } as ScheduleIssue, // Sun → snaps to Mon
        { id: "c" } as ScheduleIssue, // no dates
      ],
      { constraints: { a: { kind: "SNET", day: MON } } },
    );
    expect(tasks[0]).toMatchObject({ id: "a", earliestStartDay: FRI, constraint: { kind: "SNET", day: MON } });
    expect(tasks[1]).toMatchObject({ id: "b", earliestStartDay: MON }); // 01-04 is a Sunday → Mon
    expect(tasks[2]!.earliestStartDay).toBeUndefined();
    expect("constraint" in tasks[2]!).toBe(false);
  });
});

describe("dependencyEdgesToTyped", () => {
  const P = "proj";
  const ids = new Set(["A", "B", "C", "D"]);
  it("maps blocks → FS(from→to) and depends_on → FS(to→from), skips relates_to", () => {
    const edges = [
      edge(ref("jira", P, "A"), ref("jira", P, "B"), "blocks"),
      edge(ref("jira", P, "C"), ref("jira", P, "D"), "depends_on"),
      edge(ref("jira", P, "A"), ref("jira", P, "C"), "relates_to"),
    ];
    const typed = dependencyEdgesToTyped(edges, P, ids);
    expect(typed).toEqual([
      { predecessorId: "A", successorId: "B", kind: "FS", lagWorkingDays: 0 },
      { predecessorId: "D", successorId: "C", kind: "FS", lagWorkingDays: 0 },
    ]);
  });
  it("drops cross-project edges and edges with an endpoint outside the id set", () => {
    const edges = [
      edge(ref("jira", "other", "A"), ref("jira", "other", "B"), "blocks"), // wrong project
      edge(ref("jira", P, "A"), ref("jira", P, "ghost"), "blocks"), // endpoint not an issue
    ];
    expect(dependencyEdgesToTyped(edges, P, ids)).toEqual([]);
  });
});
