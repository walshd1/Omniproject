/**
 * Recurring-task engine — the PURE next-occurrence computer. A task carries a free-text `recurrence` rule
 * (Todoist-style "every 2 weeks", "every weekday", "every monday", or an RRULE-lite "FREQ=WEEKLY;INTERVAL=2");
 * this turns that rule + a reference date into the NEXT date it should fall due. No I/O — the tasks route
 * calls it when a recurring task is completed to spawn the following occurrence, so the schedule maths is
 * fully unit-testable and independent of any backend. Unparseable / one-off rules return null (no next).
 */

const DAY_MS = 86_400_000;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const UNIT_DAYS: Record<string, "day" | "week" | "month" | "year"> = {
  day: "day", days: "day", daily: "day",
  week: "week", weeks: "week", weekly: "week",
  month: "month", months: "month", monthly: "month",
  year: "year", years: "year", yearly: "year", annually: "year",
};

/** Parse a YYYY-MM-DD (or ISO) string to a UTC date at midnight, or null. */
function parseDay(iso: string): Date | null {
  const t = Date.parse(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const toISODate = (d: Date): string => d.toISOString().slice(0, 10);

/** Add a whole number of calendar units to a UTC date (month/year clamp the day-of-month, e.g. Jan 31 +1mo → Feb 28/29). */
function addUnit(d: Date, unit: "day" | "week" | "month" | "year", n: number): Date {
  if (unit === "day") return new Date(d.getTime() + n * DAY_MS);
  if (unit === "week") return new Date(d.getTime() + n * 7 * DAY_MS);
  const y = d.getUTCFullYear() + (unit === "year" ? n : 0);
  const m = d.getUTCMonth() + (unit === "month" ? n : 0);
  const targetY = y + Math.floor(m / 12);
  const targetM = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetY, targetM + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetY, targetM, Math.min(d.getUTCDate(), lastDay)));
}

/** The next weekday strictly after `d` matching `targetDow` (0=Sun…6=Sat). */
function nextWeekday(d: Date, targetDow: number): Date {
  const cur = d.getUTCDay();
  const delta = ((targetDow - cur + 7) % 7) || 7; // strictly after → never 0
  return new Date(d.getTime() + delta * DAY_MS);
}

/** The next Mon–Fri strictly after `d`. */
function nextWeekdayBusiness(d: Date): Date {
  let n = new Date(d.getTime() + DAY_MS);
  while (n.getUTCDay() === 0 || n.getUTCDay() === 6) n = new Date(n.getTime() + DAY_MS);
  return n;
}

/**
 * The next occurrence date (YYYY-MM-DD) for `rule` after the reference date `afterISO`, or null when the
 * rule is empty / one-off / unparseable. Recognises: daily/weekly/monthly/yearly, "every N <unit>",
 * "every weekday", "every <weekday-name>", and RRULE-lite (`FREQ=DAILY|WEEKLY|MONTHLY|YEARLY[;INTERVAL=n]`).
 */
export function nextOccurrence(rule: string | null | undefined, afterISO: string): string | null {
  const base = afterISO ? parseDay(afterISO) : null;
  if (!rule || !base) return null;
  const r = rule.trim().toLowerCase();
  if (!r) return null;

  // RRULE-lite: FREQ=WEEKLY;INTERVAL=2
  const freqM = /freq=(daily|weekly|monthly|yearly)/.exec(r);
  if (freqM) {
    const unit = ({ daily: "day", weekly: "week", monthly: "month", yearly: "year" } as const)[freqM[1] as "daily"];
    const interval = Number(/interval=(\d+)/.exec(r)?.[1] ?? "1") || 1;
    return toISODate(addUnit(base, unit, interval));
  }

  // "every weekday" (Mon–Fri)
  if (/\bevery\s+weekday\b/.test(r) || r === "weekday" || r === "weekdays") return toISODate(nextWeekdayBusiness(base));

  // "every <weekday-name>" → next that day of week
  const dowM = /\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/.exec(r)
    ?? /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?$/.exec(r);
  if (dowM) return toISODate(nextWeekday(base, WEEKDAYS.indexOf(dowM[1]!)));

  // "every N <unit>" or "every <unit>" or a bare unit word (daily/weekly/…)
  const everyM = /\bevery\s+(\d+)?\s*([a-z]+)\b/.exec(r);
  const unitWord = everyM?.[2] ?? r;
  const unit = UNIT_DAYS[unitWord];
  if (unit) {
    const n = everyM?.[1] ? Math.max(1, Number(everyM[1])) : 1;
    return toISODate(addUnit(base, unit, n));
  }
  return null; // one-off / unrecognised
}

/** Whether a rule produces recurrences (i.e. is understood by {@link nextOccurrence}). */
export function isRecurring(rule: string | null | undefined): boolean {
  return !!rule && nextOccurrence(rule, "2000-01-01") !== null;
}
