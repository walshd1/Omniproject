import { describe, it, expect } from "vitest";
import { DEFAULT_WORKING_CALENDAR, workingFinish } from "./working-calendar";
import {
  normaliseDependencyKind,
  startFromFinish,
  earliestStartFromDependency,
  applyConstraint,
  constraintViolation,
  placementOf,
  type Placement,
} from "./schedule-constraints";

/**
 * Typed dependencies + task constraints, on the shared ruler (day 0 = 1970-01-01 Thu):
 *   Thu 0 · Fri 1 · Sat 2 · Sun 3 · Mon 4 · Tue 5 · Wed 6 · Thu 7 · Fri 8
 * Default Mon–Fri calendar throughout. The predecessor is placed Mon–Tue (start 4, finish 5) so the
 * dependency math stays positive and legible.
 */
const cal = DEFAULT_WORKING_CALENDAR;
const MON = 4, TUE = 5, WED = 6, FRI = 1;
const pred: Placement = { startDay: MON, finishDay: TUE }; // a 2-working-day task, Mon–Tue

describe("normaliseDependencyKind", () => {
  it("defaults unknowns to FS and passes valid kinds through", () => {
    expect(normaliseDependencyKind(undefined)).toBe("FS");
    expect(normaliseDependencyKind("nonsense")).toBe("FS");
    expect(normaliseDependencyKind("SS")).toBe("SS");
    expect(normaliseDependencyKind("FF")).toBe("FF");
    expect(normaliseDependencyKind("SF")).toBe("SF");
  });
});

describe("startFromFinish inverts workingFinish", () => {
  it("round-trips: a start placed to finish on a target lands on that finish", () => {
    for (const dur of [1, 2, 3, 5]) {
      const start = startFromFinish(cal, WED, dur);
      expect(workingFinish(cal, start, dur)).toBe(WED);
    }
  });
});

describe("earliestStartFromDependency", () => {
  const succDur = 2;
  it("FS: successor starts the working day after the predecessor finishes (+lag)", () => {
    expect(earliestStartFromDependency(cal, { kind: "FS", lagWorkingDays: 0 }, pred, succDur)).toBe(WED); // Wed, day after Tue
    // lag 2 working days → skip Wed, Thu → Fri
    expect(earliestStartFromDependency(cal, { kind: "FS", lagWorkingDays: 2 }, pred, succDur)).toBe(8);
  });
  it("SS: successor starts with the predecessor (+lag)", () => {
    expect(earliestStartFromDependency(cal, { kind: "SS", lagWorkingDays: 0 }, pred, succDur)).toBe(MON);
    expect(earliestStartFromDependency(cal, { kind: "SS", lagWorkingDays: 1 }, pred, succDur)).toBe(TUE);
  });
  it("FF: successor finishes with the predecessor → start derived from its duration", () => {
    const start = earliestStartFromDependency(cal, { kind: "FF", lagWorkingDays: 0 }, pred, succDur);
    expect(start).toBe(MON); // 2-day task finishing Tue starts Mon
    expect(workingFinish(cal, start, succDur)).toBe(pred.finishDay);
  });
  it("SF: successor finishes when the predecessor starts", () => {
    const start = earliestStartFromDependency(cal, { kind: "SF", lagWorkingDays: 0 }, pred, succDur);
    expect(workingFinish(cal, start, succDur)).toBe(pred.startDay); // finishes Mon
    expect(start).toBe(FRI); // 2-day task finishing Mon starts Fri
  });
});

describe("applyConstraint (forward pass)", () => {
  const dur = 2;
  it("ASAP / none just snaps the proposed start to a working day", () => {
    expect(applyConstraint(cal, undefined, 2 /* Sat */, dur)).toBe(MON);
    expect(applyConstraint(cal, { kind: "ASAP" }, MON, dur)).toBe(MON);
  });
  it("SNET pushes later, never earlier", () => {
    expect(applyConstraint(cal, { kind: "SNET", day: WED }, MON, dur)).toBe(WED);
    expect(applyConstraint(cal, { kind: "SNET", day: WED }, 8 /* Fri */, dur)).toBe(8);
  });
  it("FNET moves the start so the finish is no earlier than the target", () => {
    const start = applyConstraint(cal, { kind: "FNET", day: WED }, MON, dur);
    expect(start).toBe(TUE); // 2-day task must finish ≥ Wed → start Tue
    expect(workingFinish(cal, start, dur)).toBe(WED);
  });
  it("MSO fixes the start; MFO fixes the finish", () => {
    expect(applyConstraint(cal, { kind: "MSO", day: WED }, MON, dur)).toBe(WED);
    const mfo = applyConstraint(cal, { kind: "MFO", day: WED }, MON, dur);
    expect(workingFinish(cal, mfo, dur)).toBe(WED);
    expect(mfo).toBe(TUE);
  });
  it("SNLT / FNLT don't pull a forward pass earlier (they're deadlines)", () => {
    expect(applyConstraint(cal, { kind: "SNLT", day: MON }, WED, dur)).toBe(WED);
    expect(applyConstraint(cal, { kind: "FNLT", day: MON }, WED, dur)).toBe(WED);
  });
});

describe("constraintViolation", () => {
  it("flags the 'no later than' and 'must' kinds when breached", () => {
    expect(constraintViolation({ kind: "SNLT", day: MON }, { startDay: WED, finishDay: 7 })).toBe(true);
    expect(constraintViolation({ kind: "SNLT", day: WED }, { startDay: WED, finishDay: 7 })).toBe(false);
    expect(constraintViolation({ kind: "FNLT", day: TUE }, { startDay: MON, finishDay: WED })).toBe(true);
    expect(constraintViolation({ kind: "MSO", day: MON }, { startDay: WED, finishDay: 7 })).toBe(true);
    expect(constraintViolation({ kind: "MFO", day: WED }, { startDay: MON, finishDay: TUE })).toBe(true);
  });
  it("never flags the 'no earlier' / ASAP kinds (already enforced forward)", () => {
    expect(constraintViolation({ kind: "SNET", day: 99 }, { startDay: MON, finishDay: TUE })).toBe(false);
    expect(constraintViolation({ kind: "ASAP" }, { startDay: MON, finishDay: TUE })).toBe(false);
    expect(constraintViolation(undefined, { startDay: MON, finishDay: TUE })).toBe(false);
  });
});

describe("placementOf", () => {
  it("snaps the start and computes the inclusive finish", () => {
    expect(placementOf(cal, 2 /* Sat */, 3)).toEqual({ startDay: MON, finishDay: WED }); // Mon,Tue,Wed
  });
});
