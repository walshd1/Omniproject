/**
 * NATURAL-LANGUAGE DATE PARSING — pure, browser-side. Turns a human date phrase ("tomorrow",
 * "next friday", "in 3 days", "eow", "2026-03-01") into an ISO date (YYYY-MM-DD) for the quick-add bar
 * and any date input, BEFORE the write. The reference "today" is injected (never read from a clock here)
 * so the function stays pure + unit-testable; the one caller at the browser edge passes `new Date()`.
 *
 * All maths is in UTC (midnight-anchored) so a phrase resolves to the same calendar day regardless of the
 * viewer's timezone — the value stored is a date, not an instant. Unrecognised phrases return null.
 */

const DAY_MS = 86_400_000;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_ALIAS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};

const utcMidnight = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const toISODate = (d: Date): string => d.toISOString().slice(0, 10);

/** The next occurrence of `dow` (0=Sun…6=Sat) STRICTLY after `from` (so "monday" on a Monday means next week). */
function nextWeekday(from: Date, dow: number): Date {
  const cur = from.getUTCDay();
  const delta = ((dow - cur + 7) % 7) || 7;
  return new Date(from.getTime() + delta * DAY_MS);
}

/**
 * Parse a natural date `phrase` relative to `today`, returning an ISO `YYYY-MM-DD` or null. Recognises:
 *   today · tomorrow · tod · tmr · yesterday · eod (end of day = today) · eow (end of week = coming Sunday) ·
 *   <weekday> / next <weekday> · in N day|week|month|year(s) · N (bare = N days) · an explicit ISO date.
 */
export function parseNaturalDate(phrase: string, today: Date): string | null {
  const base = utcMidnight(today);
  const p = phrase.trim().toLowerCase();
  if (!p) return null;

  // Explicit ISO / parseable date first (so "2026-03-01" is never mistaken for a keyword).
  if (/^\d{4}-\d{2}-\d{2}/.test(p)) {
    const t = Date.parse(p.length <= 10 ? `${p}T00:00:00Z` : p);
    return Number.isNaN(t) ? null : toISODate(utcMidnight(new Date(t)));
  }

  if (p === "today" || p === "tod" || p === "eod") return toISODate(base);
  if (p === "tomorrow" || p === "tmr" || p === "tom") return toISODate(new Date(base.getTime() + DAY_MS));
  if (p === "yesterday" || p === "yst") return toISODate(new Date(base.getTime() - DAY_MS));
  if (p === "eow") return toISODate(nextWeekday(base, 0)); // coming Sunday (end of week)

  // next <weekday>  /  <weekday>  (both mean the next such day strictly after today).
  const wd = /^(?:next\s+)?([a-z]+)$/.exec(p);
  if (wd && WEEKDAY_ALIAS[wd[1]!] !== undefined) return toISODate(nextWeekday(base, WEEKDAY_ALIAS[wd[1]!]!));

  // in N <unit>(s)
  const rel = /^in\s+(\d+)\s+(day|days|week|weeks|month|months|year|years)$/.exec(p);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2]!;
    if (unit.startsWith("day")) return toISODate(new Date(base.getTime() + n * DAY_MS));
    if (unit.startsWith("week")) return toISODate(new Date(base.getTime() + n * 7 * DAY_MS));
    if (unit.startsWith("month")) return toISODate(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + n, base.getUTCDate())));
    return toISODate(new Date(Date.UTC(base.getUTCFullYear() + n, base.getUTCMonth(), base.getUTCDate())));
  }

  // A bare positive integer means "in N days".
  if (/^\d+$/.test(p)) return toISODate(new Date(base.getTime() + Number(p) * DAY_MS));

  return null;
}

/** True when a token is a recognised date phrase relative to `today` — used by the quick-add parser to
 *  pull an unsigiled date word out of the title. (A single token only; multi-word phrases go via `^`.) */
export function isNaturalDateToken(token: string, today: Date): boolean {
  return parseNaturalDate(token, today) !== null && !/^\d+$/.test(token.trim());
}

export { WEEKDAYS };
