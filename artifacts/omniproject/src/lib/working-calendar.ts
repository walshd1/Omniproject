import { DAY_MS } from "./date-utils";

/**
 * Working calendar — a pure, stateless model of which whole-day indices are WORKING time (vs weekends /
 * holidays), plus calendar-aware day arithmetic. The foundation the interactive scheduling engine
 * (roadmap 3.1) builds on: the CPM / what-if engines count in "days", but a real plan skips non-working
 * days, so "3 days after Friday" lands on Wednesday, not Monday.
 *
 * Day indices match the rest of the scheduling stack (`date-utils` DAY_MS floor): day 0 = 1970-01-01, a
 * Thursday. The weekday is derived in **UTC** to match `schedule-scenario.startOfDay` (which floors the raw
 * epoch). Everything here is pure — like `critical-path.ts` / `schedule-scenario.ts` — so the maths is fully
 * unit-testable and is never a source of truth (no persistence, no server call, projected only).
 */

/** Weekday index, 0 = Sunday … 6 = Saturday (matches `Date.getUTCDay`). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Monday–Friday — the default working week. */
export const DEFAULT_WORKING_WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5];

/**
 * A resolved working calendar. `workingExceptions` (a day forced to WORKING) win over everything;
 * otherwise a `holiday` is non-working; otherwise membership of `workingWeekdays` decides.
 */
export interface WorkingCalendar {
  /** The weekdays that are working days. */
  workingWeekdays: ReadonlySet<Weekday>;
  /** Whole-day indices that are non-working even though they fall on a working weekday (holidays). */
  holidays: ReadonlySet<number>;
  /** Whole-day indices forced to WORKING even if a weekend/holiday — exceptions always win. */
  workingExceptions: ReadonlySet<number>;
}

/** The whole-day index for an ISO date string (UTC floor), or NaN if unparseable. */
export function isoToDay(iso: string): number {
  return Math.floor(new Date(iso).getTime() / DAY_MS);
}

/** The weekday (0 = Sun … 6 = Sat) a whole-day index falls on. */
export function weekdayOf(day: number): Weekday {
  return new Date(day * DAY_MS).getUTCDay() as Weekday;
}

/** Coerce a mix of ISO strings and day indices into a set of valid day indices (drops NaN). */
function toDaySet(values: ReadonlyArray<number | string> | undefined): Set<number> {
  const out = new Set<number>();
  for (const v of values ?? []) {
    const day = typeof v === "string" ? isoToDay(v) : v;
    if (Number.isFinite(day)) out.add(day);
  }
  return out;
}

export interface WorkingCalendarInit {
  /** Working weekdays; defaults to Mon–Fri. An empty array is rejected (a week with no working day
   *  would make the arithmetic non-terminating) and falls back to the default. */
  workingWeekdays?: readonly Weekday[];
  /** Holidays, as ISO date strings or day indices. */
  holidays?: ReadonlyArray<number | string>;
  /** Days forced to working, as ISO date strings or day indices (win over weekend/holiday). */
  workingExceptions?: ReadonlyArray<number | string>;
}

/** Build a working calendar from a loose init (Mon–Fri, no holidays by default). Pure + defensive. */
export function makeWorkingCalendar(init: WorkingCalendarInit = {}): WorkingCalendar {
  const weekdays = init.workingWeekdays && init.workingWeekdays.length > 0 ? init.workingWeekdays : DEFAULT_WORKING_WEEKDAYS;
  return {
    workingWeekdays: new Set(weekdays),
    holidays: toDaySet(init.holidays),
    workingExceptions: toDaySet(init.workingExceptions),
  };
}

/** The default Mon–Fri, no-holiday calendar — a shared constant for callers that need no customisation. */
export const DEFAULT_WORKING_CALENDAR: WorkingCalendar = makeWorkingCalendar();

/** Whether a whole-day index is a working day under this calendar. */
export function isWorkingDay(cal: WorkingCalendar, day: number): boolean {
  if (cal.workingExceptions.has(day)) return true; // exceptions always win
  if (cal.holidays.has(day)) return false;
  return cal.workingWeekdays.has(weekdayOf(day));
}

/** The first working day at or after `day`. */
export function nextWorkingDay(cal: WorkingCalendar, day: number): number {
  let d = day;
  // Bounded by (7 + holiday run); a valid calendar has ≥1 working weekday so this terminates.
  for (let guard = 0; guard < 3660 && !isWorkingDay(cal, d); guard++) d++;
  return d;
}

/** The last working day at or before `day`. */
export function prevWorkingDay(cal: WorkingCalendar, day: number): number {
  let d = day;
  for (let guard = 0; guard < 3660 && !isWorkingDay(cal, d); guard++) d--;
  return d;
}

/**
 * Advance `n` working days from `day`. The start is first snapped to a working day (forward for n ≥ 0,
 * backward for n < 0), then stepped |n| working days in that direction. So with a Mon–Fri calendar,
 * `addWorkingDays(Fri, 1)` = Mon, and `addWorkingDays(Sat, 0)` = the following Mon. Pure.
 */
export function addWorkingDays(cal: WorkingCalendar, day: number, n: number): number {
  if (n >= 0) {
    let d = nextWorkingDay(cal, day);
    for (let i = 0; i < n; i++) d = nextWorkingDay(cal, d + 1);
    return d;
  }
  let d = prevWorkingDay(cal, day);
  for (let i = 0; i < -n; i++) d = prevWorkingDay(cal, d - 1);
  return d;
}

/**
 * The number of working days in the half-open range `[from, to)`. Symmetric: if `to < from` the count is
 * negative. Composes with {@link addWorkingDays}: for working-day endpoints, `workingDaysBetween` counts the
 * working days you traverse leaving `from` to reach `to`. Pure; O(|to − from|).
 */
export function workingDaysBetween(cal: WorkingCalendar, from: number, to: number): number {
  if (to === from) return 0;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  let count = 0;
  for (let d = lo; d < hi; d++) if (isWorkingDay(cal, d)) count++;
  return to >= from ? count : -count;
}

/**
 * The finish day of a task of `durationWorkingDays` working days starting on `startDay`. A 0-day task is a
 * milestone (finishes the day it starts, snapped to a working day). A 1-day task starts and finishes the
 * same working day. Returns the LAST working day the task occupies. Pure.
 */
export function workingFinish(cal: WorkingCalendar, startDay: number, durationWorkingDays: number): number {
  const start = nextWorkingDay(cal, startDay);
  if (durationWorkingDays <= 1) return start;
  return addWorkingDays(cal, start, durationWorkingDays - 1);
}
