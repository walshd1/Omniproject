import { useSettingsSlice } from "./settings-query";
import { makeWorkingCalendar, DEFAULT_WORKING_CALENDAR, type WorkingCalendar, type Weekday } from "./working-calendar";

/**
 * The org's WORKING-TIME config for the scheduling engine (roadmap 3.1 follow-up) — hours per working day
 * (estimate→duration) plus the working week + holidays that build the {@link WorkingCalendar}. Read from the
 * shared `/api/settings` slice so it's a single configurable source of truth instead of a hardcoded 8h /
 * Mon–Fri; safe defaults apply while the settings load or when the block is unset.
 */

export const DEFAULT_HOURS_PER_DAY = 8;

export interface SchedulingSettings {
  hoursPerDay: number;
  calendar: WorkingCalendar;
}

/** The raw shape of the `scheduling` settings slice (all optional; validated server-side). */
export interface RawSchedulingConfig {
  hoursPerDay?: number;
  workingWeekdays?: number[];
  holidays?: string[];
}

/** Resolve a raw settings slice to a usable hours/day + working calendar, applying defaults defensively. */
export function resolveSchedulingSettings(raw: RawSchedulingConfig | undefined): SchedulingSettings {
  const hoursPerDay = typeof raw?.hoursPerDay === "number" && raw.hoursPerDay > 0 ? raw.hoursPerDay : DEFAULT_HOURS_PER_DAY;
  const calendar = raw
    ? makeWorkingCalendar({
        ...(raw.workingWeekdays ? { workingWeekdays: raw.workingWeekdays as Weekday[] } : {}),
        ...(raw.holidays ? { holidays: raw.holidays } : {}),
      })
    : DEFAULT_WORKING_CALENDAR;
  return { hoursPerDay, calendar };
}

/** Subscribe to the org working-time config (hours/day + calendar), with safe defaults while loading. */
export function useSchedulingSettings(): SchedulingSettings {
  const { data } = useSettingsSlice((s) => s["scheduling"] as RawSchedulingConfig | undefined);
  return resolveSchedulingSettings(data);
}
