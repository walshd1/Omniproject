/**
 * A compact, pure STANDARD 5-field cron matcher — "does this UTC minute match this cron expression?". Used by
 * the schedule dispatcher to decide whether a schedule-triggered automation is due in the current window. No
 * dependencies, minute granularity, UTC (the whole gateway reasons in UTC).
 *
 * Fields: `minute hour day-of-month month day-of-week`. Each supports `*`, `a`, `a-b`, `a,b,c`, and `* / n`
 * (step). Month is 1-12, day-of-week 0-6 (0 = Sunday). Day-of-month and day-of-week are OR'd when BOTH are
 * restricted (the standard cron quirk), so `0 0 1 * 1` fires on the 1st OR any Monday.
 */

export class CronError extends Error {
  constructor(message: string) { super(message); this.name = "CronError"; }
}

interface Field { min: number; max: number }
const MINUTE: Field = { min: 0, max: 59 };
const HOUR: Field = { min: 0, max: 23 };
const DOM: Field = { min: 1, max: 31 };
const MONTH: Field = { min: 1, max: 12 };
const DOW: Field = { min: 0, max: 6 };

/** Parse one cron field into the set of matching integers. Throws {@link CronError} on a malformed field. */
function parseField(spec: string, f: Field): Set<number> {
  const out = new Set<number>();
  for (const partRaw of spec.split(",")) {
    const part = partRaw.trim();
    if (part === "") throw new CronError(`empty cron field element in "${spec}"`);
    let step = 1;
    let range = part;
    const slash = part.indexOf("/");
    if (slash >= 0) {
      step = Number(part.slice(slash + 1));
      range = part.slice(0, slash);
      if (!Number.isInteger(step) || step <= 0) throw new CronError(`bad cron step in "${part}"`);
    }
    let lo = f.min, hi = f.max;
    if (range !== "*") {
      const dash = range.indexOf("-");
      if (dash >= 0) { lo = Number(range.slice(0, dash)); hi = Number(range.slice(dash + 1)); }
      else { lo = hi = Number(range); }
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < f.min || hi > f.max || lo > hi) {
        throw new CronError(`cron value out of range in "${part}" (expected ${f.min}-${f.max})`);
      }
    }
    for (let n = lo; n <= hi; n += step) out.add(n);
  }
  return out;
}

export interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  /** True when BOTH dom and dow are restricted (⇒ OR them, the standard cron rule). */
  domRestricted: boolean;
  dowRestricted: boolean;
}

/** Parse a 5-field cron expression. Throws {@link CronError} on a wrong field count or a bad field. */
export function parseCron(expr: string): CronSpec {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new CronError(`cron must have 5 fields (got ${parts.length}): "${expr}"`);
  return {
    minute: parseField(parts[0]!, MINUTE),
    hour: parseField(parts[1]!, HOUR),
    dom: parseField(parts[2]!, DOM),
    month: parseField(parts[3]!, MONTH),
    dow: parseField(parts[4]!, DOW),
    domRestricted: parts[2] !== "*",
    dowRestricted: parts[4] !== "*",
  };
}

/** Does `date` (its UTC minute) match the parsed cron? */
export function cronSpecMatches(spec: CronSpec, date: Date): boolean {
  if (!spec.minute.has(date.getUTCMinutes())) return false;
  if (!spec.hour.has(date.getUTCHours())) return false;
  if (!spec.month.has(date.getUTCMonth() + 1)) return false;
  const domHit = spec.dom.has(date.getUTCDate());
  const dowHit = spec.dow.has(date.getUTCDay());
  // Standard cron: if both day fields are restricted, a match on EITHER is enough; else the restricted one wins.
  if (spec.domRestricted && spec.dowRestricted) return domHit || dowHit;
  if (spec.domRestricted) return domHit;
  if (spec.dowRestricted) return dowHit;
  return true;
}

/** Does the given UTC minute match the cron expression? Convenience over {@link parseCron} + {@link cronSpecMatches}. */
export function cronMatches(expr: string, date: Date): boolean {
  return cronSpecMatches(parseCron(expr), date);
}

/** Is the cron expression well-formed? (For validation without throwing.) */
export function isValidCron(expr: string): boolean {
  try { parseCron(expr); return true; } catch { return false; }
}

/**
 * The distinct UTC minutes in `(afterMs, throughMs]` at which `expr` fires — the "due since last tick" set the
 * dispatcher iterates. Bounded: scans at most `maxMinutes` minutes back from `throughMs` (so a long outage can't
 * make one tick unbounded), newest-window first. Each returned Date is on a whole minute (seconds zeroed).
 */
export function cronMinutesInWindow(expr: string, afterMs: number, throughMs: number, maxMinutes = 1440): Date[] {
  const spec = parseCron(expr);
  const out: Date[] = [];
  const startMs = Math.max(afterMs + 1, throughMs - (maxMinutes - 1) * 60_000);
  // Align to the minute at/above startMs.
  let t = Math.ceil(startMs / 60_000) * 60_000;
  for (; t <= throughMs; t += 60_000) {
    const d = new Date(t);
    if (cronSpecMatches(spec, d)) out.push(d);
  }
  return out;
}
