import { describe, it, expect } from "vitest";
import {
  makeWorkingCalendar,
  DEFAULT_WORKING_CALENDAR,
  isWorkingDay,
  isoToDay,
  weekdayOf,
  nextWorkingDay,
  prevWorkingDay,
  addWorkingDays,
  workingDaysBetween,
  workingFinish,
} from "./working-calendar";

/**
 * The working-calendar engine. Anchored to the shared day bucketing: day 0 = 1970-01-01, a THURSDAY, so
 *   day 0 Thu · 1 Fri · 2 Sat · 3 Sun · 4 Mon · 5 Tue · 6 Wed · 7 Thu …
 * All the arithmetic below is checked against that ruler with the default Mon–Fri calendar.
 */

const THU = 0, FRI = 1, SAT = 2, SUN = 3, MON = 4, TUE = 5, WED = 6, NEXT_THU = 7;
const cal = DEFAULT_WORKING_CALENDAR;

describe("day ↔ weekday anchoring", () => {
  it("day 0 is 1970-01-01, a Thursday, and ISO round-trips", () => {
    expect(isoToDay("1970-01-01")).toBe(0);
    expect(weekdayOf(0)).toBe(4); // Thursday
    expect(weekdayOf(SAT)).toBe(6);
    expect(weekdayOf(SUN)).toBe(0);
    expect(isoToDay("not-a-date")).toBeNaN();
  });
});

describe("isWorkingDay (default Mon–Fri)", () => {
  it("treats the weekend as non-working and weekdays as working", () => {
    expect([THU, FRI, MON, TUE, WED, NEXT_THU].every((d) => isWorkingDay(cal, d))).toBe(true);
    expect(isWorkingDay(cal, SAT)).toBe(false);
    expect(isWorkingDay(cal, SUN)).toBe(false);
  });

  it("holidays are non-working; working-exceptions win over weekend AND holiday", () => {
    const c = makeWorkingCalendar({ holidays: [MON], workingExceptions: [SAT] });
    expect(isWorkingDay(c, MON)).toBe(false); // holiday on a Monday
    expect(isWorkingDay(c, SAT)).toBe(true); // forced working weekend
    // A day that is both a holiday and an exception → exception wins.
    const both = makeWorkingCalendar({ holidays: [TUE], workingExceptions: [TUE] });
    expect(isWorkingDay(both, TUE)).toBe(true);
  });

  it("accepts holidays as ISO strings and an empty week falls back to Mon–Fri", () => {
    const c = makeWorkingCalendar({ holidays: ["1970-01-01"] }); // day 0
    expect(isWorkingDay(c, THU)).toBe(false);
    const empty = makeWorkingCalendar({ workingWeekdays: [] });
    expect(isWorkingDay(empty, MON)).toBe(true); // fell back to default
  });
});

describe("snapping", () => {
  it("nextWorkingDay / prevWorkingDay skip the weekend", () => {
    expect(nextWorkingDay(cal, FRI)).toBe(FRI); // already working
    expect(nextWorkingDay(cal, SAT)).toBe(MON);
    expect(nextWorkingDay(cal, SUN)).toBe(MON);
    expect(prevWorkingDay(cal, SAT)).toBe(FRI);
    expect(prevWorkingDay(cal, SUN)).toBe(FRI);
  });
});

describe("addWorkingDays", () => {
  it("one working day after Friday is Monday", () => {
    expect(addWorkingDays(cal, FRI, 1)).toBe(MON);
  });
  it("zero snaps a non-working start forward to the next working day", () => {
    expect(addWorkingDays(cal, SAT, 0)).toBe(MON);
    expect(addWorkingDays(cal, FRI, 0)).toBe(FRI);
  });
  it("steps across a whole week", () => {
    // Thu +5 working days: Fri, Mon, Tue, Wed, next-Thu
    expect(addWorkingDays(cal, THU, 5)).toBe(NEXT_THU);
  });
  it("goes backward, snapping the other way", () => {
    expect(addWorkingDays(cal, MON, -1)).toBe(FRI);
    expect(prevWorkingDay(cal, SUN)).toBe(FRI); // the backward snap
    expect(addWorkingDays(cal, NEXT_THU, -5)).toBe(THU);
  });
  it("respects holidays when stepping", () => {
    const c = makeWorkingCalendar({ holidays: [MON] }); // Mon is a holiday
    // Fri +1 skips Sat, Sun, and the Mon holiday → Tue
    expect(addWorkingDays(c, FRI, 1)).toBe(TUE);
  });
});

describe("workingDaysBetween", () => {
  it("counts working days in the half-open range and is sign-symmetric", () => {
    expect(workingDaysBetween(cal, THU, NEXT_THU)).toBe(5); // one working week
    expect(workingDaysBetween(cal, FRI, MON)).toBe(1); // only Fri is working in [1,4)
    expect(workingDaysBetween(cal, THU, THU)).toBe(0);
    expect(workingDaysBetween(cal, NEXT_THU, THU)).toBe(-5);
  });
});

describe("workingFinish", () => {
  it("a milestone (0/1 day) finishes on its snapped start", () => {
    expect(workingFinish(cal, FRI, 0)).toBe(FRI);
    expect(workingFinish(cal, SAT, 1)).toBe(MON); // snaps forward
  });
  it("a multi-day task returns the last working day it occupies", () => {
    // 3 working days from Thu: Thu, Fri, Mon → finishes Mon
    expect(workingFinish(cal, THU, 3)).toBe(MON);
  });
});
