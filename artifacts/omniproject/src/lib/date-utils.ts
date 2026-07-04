/** One day in milliseconds — the whole-day bucketing unit shared by the Gantt, the schedule
 *  sandbox and the pure reschedule/schedule-scenario engines behind them. */
export const DAY_MS = 1000 * 60 * 60 * 24;

/** Format a whole-day index (as bucketed by `DAY_MS`) as a short date, e.g. "Jan 5". */
export function dayToShortDate(day: number): string {
  return new Date(day * DAY_MS).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
