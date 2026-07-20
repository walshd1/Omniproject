import { describe, it, expect } from "vitest";
import { resolveSchedulingSettings, DEFAULT_HOURS_PER_DAY } from "./scheduling-settings";
import { isWorkingDay } from "./working-calendar";

/**
 * The org working-time config resolver. Ruler: day 0 = 1970-01-01 Thu; day 2 Sat, day 3 Sun. Defaults to
 * 8h / Mon–Fri when the settings slice is absent or partial.
 */
describe("resolveSchedulingSettings", () => {
  it("falls back to 8h and a Mon–Fri calendar when unset", () => {
    const s = resolveSchedulingSettings(undefined);
    expect(s.hoursPerDay).toBe(DEFAULT_HOURS_PER_DAY);
    expect(isWorkingDay(s.calendar, 4)).toBe(true); // Mon
    expect(isWorkingDay(s.calendar, 2)).toBe(false); // Sat
  });

  it("applies a configured hours-per-day", () => {
    expect(resolveSchedulingSettings({ hoursPerDay: 6 }).hoursPerDay).toBe(6);
    // Non-positive / bad values fall back to the default.
    expect(resolveSchedulingSettings({ hoursPerDay: 0 }).hoursPerDay).toBe(DEFAULT_HOURS_PER_DAY);
  });

  it("builds the calendar from configured working weekdays + holidays", () => {
    const s = resolveSchedulingSettings({ workingWeekdays: [0, 1, 2, 3, 4, 5, 6], holidays: ["1970-01-01"] });
    expect(isWorkingDay(s.calendar, 2)).toBe(true); // Sat now working (7-day week)
    expect(isWorkingDay(s.calendar, 0)).toBe(false); // 1970-01-01 is a holiday
  });
});
