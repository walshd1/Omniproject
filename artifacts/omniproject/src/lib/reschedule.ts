/**
 * Pure date-shift helpers for live drag-to-reschedule on the Gantt. Kept separate
 * from the React component so the arithmetic is unit-tested without simulating
 * pointer events (jsdom can't measure pixel geometry).
 */
const DAY_MS = 1000 * 60 * 60 * 24;

/** Shift an ISO date string by whole days, returning a date-only `YYYY-MM-DD`. */
export function shiftIsoDate(iso: string, deltaDays: number): string {
  const d = new Date(iso);
  return new Date(d.getTime() + deltaDays * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The new start/due for an issue moved by `deltaDays` on the timeline. Only the
 * dates the issue actually has are shifted (a milestone with one date stays a
 * milestone); the duration is preserved because both ends move together.
 */
export function rescheduledDates(
  issue: { startDate?: string | null; dueDate?: string | null },
  deltaDays: number,
): { startDate: string | null; dueDate: string | null } {
  return {
    startDate: issue.startDate ? shiftIsoDate(issue.startDate, deltaDays) : null,
    dueDate: issue.dueDate ? shiftIsoDate(issue.dueDate, deltaDays) : null,
  };
}
