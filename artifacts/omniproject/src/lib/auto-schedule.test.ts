import { describe, it, expect } from "vitest";
import { DEFAULT_WORKING_CALENDAR } from "./working-calendar";
import { autoSchedule, type AutoScheduleInput } from "./auto-schedule";
import type { TypedDependency } from "./schedule-constraints";

/**
 * The forward-pass auto-scheduler, on the shared ruler (day 0 = 1970-01-01 Thu):
 *   Thu 0 · Fri 1 · Sat 2 · Sun 3 · Mon 4 · Tue 5 · Wed 6 · Thu 7 · Fri 8
 * Default Mon–Fri calendar; project start Mon (day 4) unless noted.
 */
const cal = DEFAULT_WORKING_CALENDAR;
const MON = 4, TUE = 5, WED = 6, THU2 = 7, FRI2 = 8;
const fs = (p: string, s: string, lag = 0): TypedDependency => ({ predecessorId: p, successorId: s, kind: "FS", lagWorkingDays: lag });

function run(partial: Partial<AutoScheduleInput> & Pick<AutoScheduleInput, "tasks">) {
  return autoSchedule(cal, { dependencies: [], projectStartDay: MON, ...partial });
}

describe("autoSchedule — FS chain", () => {
  it("places a task after its predecessor finishes, skipping the weekend", () => {
    const res = run({
      tasks: [
        { id: "A", durationWorkingDays: 2 }, // Mon–Tue
        { id: "B", durationWorkingDays: 3 }, // starts Wed after A, runs Wed–Fri
      ],
      dependencies: [fs("A", "B")],
    });
    expect(res.tasks["A"]).toMatchObject({ startDay: MON, finishDay: TUE });
    expect(res.tasks["B"]).toMatchObject({ startDay: WED, finishDay: FRI2, driverId: "A" });
    expect(res.projectStartDay).toBe(MON);
    expect(res.projectFinishDay).toBe(FRI2);
    expect(res.hasCycle).toBe(false);
    expect(res.violations).toEqual([]);
  });

  it("honours a positive FS lag in working days", () => {
    const res = run({
      tasks: [{ id: "A", durationWorkingDays: 2 }, { id: "B", durationWorkingDays: 1 }],
      dependencies: [fs("A", "B", 2)], // 2 working days after Tue finish → Fri
    });
    expect(res.tasks["B"]!.startDay).toBe(FRI2);
  });
});

describe("autoSchedule — SS/lag", () => {
  it("SS with lag 1 starts the successor one working day after the predecessor start", () => {
    const res = run({
      tasks: [{ id: "E", durationWorkingDays: 2 }, { id: "F", durationWorkingDays: 2 }],
      dependencies: [{ predecessorId: "E", successorId: "F", kind: "SS", lagWorkingDays: 1 }],
    });
    expect(res.tasks["F"]).toMatchObject({ startDay: TUE, finishDay: WED, driverId: "E" });
  });
});

describe("autoSchedule — constraints", () => {
  it("SNET pushes a task later and clears the predecessor as driver", () => {
    const res = run({
      tasks: [
        { id: "A", durationWorkingDays: 2 },
        { id: "B", durationWorkingDays: 1, constraint: { kind: "SNET", day: FRI2 } },
      ],
      dependencies: [fs("A", "B")], // FS would put B on Wed, but SNET Fri wins
    });
    expect(res.tasks["B"]).toMatchObject({ startDay: FRI2, driverId: null });
    expect(res.violations).toEqual([]);
  });

  it("flags an FNLT deadline breached by a predecessor push", () => {
    const res = run({
      tasks: [
        { id: "A", durationWorkingDays: 2 }, // Mon–Tue
        { id: "D", durationWorkingDays: 2, constraint: { kind: "FNLT", day: WED } }, // needs to finish ≤ Wed
      ],
      dependencies: [fs("A", "D")], // forced to Wed–Thu → finishes Thu > Wed
    });
    expect(res.tasks["D"]).toMatchObject({ startDay: WED, finishDay: THU2, violatesConstraint: true });
    expect(res.violations).toEqual(["D"]);
  });

  it("a task's own earliestStartDay acts as its floor", () => {
    const res = run({ tasks: [{ id: "G", durationWorkingDays: 1, earliestStartDay: FRI2 }] });
    expect(res.tasks["G"]!.startDay).toBe(FRI2);
  });
});

describe("autoSchedule — robustness", () => {
  it("ignores a cycle and still places every node (flagged)", () => {
    const res = run({
      tasks: [{ id: "A", durationWorkingDays: 1 }, { id: "B", durationWorkingDays: 1 }],
      dependencies: [fs("A", "B"), fs("B", "A")],
    });
    expect(res.hasCycle).toBe(true);
    expect(Object.keys(res.tasks).sort()).toEqual(["A", "B"]);
  });

  it("drops edges with missing endpoints or self-loops", () => {
    const res = run({
      tasks: [{ id: "A", durationWorkingDays: 1 }],
      dependencies: [fs("A", "A"), fs("A", "ghost"), fs("ghost", "A")],
    });
    expect(res.tasks["A"]).toMatchObject({ startDay: MON, finishDay: MON });
    expect(res.hasCycle).toBe(false);
  });

  it("empty input falls back to the project start for the range", () => {
    const res = run({ tasks: [] });
    expect(res).toMatchObject({ order: [], projectStartDay: MON, projectFinishDay: MON, violations: [] });
  });
});
