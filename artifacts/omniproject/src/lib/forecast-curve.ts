/**
 * Time-phased budget forecast (S-curve). The financials endpoint returns point-in-time EVM scalars
 * (BAC, AC, EAC); a head of projects also needs to see the spend *spread over time* — the planned-value
 * S-curve, the actuals to date, and the forecast-to-go climbing to EAC. There is no time-phased data in
 * the read model, so this is a pure DERIVATION: spread the totals across the schedule window using a
 * chosen profile, split at "today" into actual vs forecast. Nothing is stored.
 */

export type SpreadProfile = "scurve" | "linear" | "frontLoaded" | "backLoaded";

export const SPREAD_PROFILES: { id: SpreadProfile; label: string; hint: string }[] = [
  { id: "scurve", label: "S-curve", hint: "slow start, fast middle, slow finish (typical delivery)" },
  { id: "linear", label: "Linear", hint: "even spend every period" },
  { id: "frontLoaded", label: "Front-loaded", hint: "heavier early (mobilisation / procurement)" },
  { id: "backLoaded", label: "Back-loaded", hint: "heavier late (integration / rollout)" },
];

/** Smoothstep cumulative — 3t² − 2t³, the canonical S-curve shape (0→0, 1→1, flat ends). */
function sCurveCum(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Per-period weights (length n, summing to 1) for a spreading profile. */
export function spreadWeights(profile: SpreadProfile, n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [1];
  if (profile === "scurve") {
    return Array.from({ length: n }, (_, i) => sCurveCum((i + 1) / n) - sCurveCum(i / n));
  }
  const raw =
    profile === "frontLoaded" ? Array.from({ length: n }, (_, i) => n - i)
    : profile === "backLoaded" ? Array.from({ length: n }, (_, i) => i + 1)
    : Array.from({ length: n }, () => 1); // linear
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / total);
}

/** Running cumulative of `weights`, prefixed with 0 (so cum[i] is the total through period i, cum[0]=0). */
function cumulative(weights: number[]): number[] {
  const cum = [0];
  for (const w of weights) cum.push(cum[cum.length - 1]! + w);
  return cum;
}

/** Inclusive list of UTC month starts (ms) from `start`'s month to `end`'s month, capped to `max`. */
export function monthBuckets(start: number, end: number, max = 36): number[] {
  const s = new Date(start);
  const lo = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1);
  const e = new Date(Math.max(end, start));
  const hi = Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), 1);
  const out: number[] = [];
  let y = new Date(lo).getUTCFullYear();
  let m = new Date(lo).getUTCMonth();
  while (Date.UTC(y, m, 1) <= hi && out.length < max) {
    out.push(Date.UTC(y, m, 1));
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return out.length ? out : [lo];
}

/** Derive the schedule window (ms) from work-item start/due dates. Returns null when no dates exist
 *  (the report then can't be time-phased). `asOf` extends the window so today is always inside it. */
export function scheduleWindow(
  items: { startDate?: string | null; dueDate?: string | null }[],
  asOf: number,
): { start: number; end: number } | null {
  // Both a start and a due bound BOTH ends of the window (a start with no due still bounds it), so
  // the min/max range is simply over every valid date. Fold it into the loop — a spread over the
  // built arrays (Math.min(...starts)) both allocates and stack-overflows past ~65k dated items.
  let lo = Infinity;
  let hi = -Infinity;
  let any = false;
  for (const it of items) {
    const s = it.startDate ? Date.parse(it.startDate) : NaN;
    const d = it.dueDate ? Date.parse(it.dueDate) : NaN;
    if (!Number.isNaN(s)) { any = true; if (s < lo) lo = s; if (s > hi) hi = s; }
    if (!Number.isNaN(d)) { any = true; if (d < lo) lo = d; if (d > hi) hi = d; }
  }
  if (!any) return null;
  const start = Math.min(lo, asOf);
  const end = Math.max(hi, asOf);
  return { start, end };
}

const MONTH_LABEL = (ms: number) =>
  new Date(ms).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });

export interface ForecastPeriod {
  /** UTC month start (ms) the bucket begins. */
  periodStart: number;
  label: string;
  /** Cumulative planned value (the baseline S-curve), always present. */
  planned: number;
  /** Cumulative actual cost — present up to and including the current period, else null. */
  actual: number | null;
  /** Cumulative forecast — present from the current period onward (climbs AC→EAC), else null. */
  forecast: number | null;
  /** True for the period containing "today". */
  isNow: boolean;
}

export interface ForecastCurve {
  periods: ForecastPeriod[];
  /** Budget at completion (the spread total). */
  bac: number;
  /** Estimate at completion (where the forecast lands). */
  eac: number;
  /** Variance at completion = BAC − EAC (negative = projected overspend). */
  vac: number;
  /** Planned value at "today" (baseline) — what should have been spent by now. */
  plannedToDate: number;
  /** Actual spent to date. */
  actualToDate: number;
  /** Index of the current period (0-based), or -1 if today is before the window. */
  nowIndex: number;
  profile: SpreadProfile;
}

export interface ForecastInput {
  bac: number;
  eac: number;
  actualToDate: number;
  /** Schedule window (ms). */
  start: number;
  end: number;
  /** "Today" (ms) — injected so the derivation is pure/testable. */
  asOf: number;
  profile: SpreadProfile;
}

/**
 * Derive the time-phased forecast. Planned value follows the profile across the window; actuals are
 * spread along the same profile up to today (anchored to the real AC scalar); forecast-to-go climbs
 * from today's AC to EAC over the remaining profile weight. Pure — no I/O, no clock read.
 */
export function timePhasedForecast(input: ForecastInput): ForecastCurve {
  const { bac, eac, actualToDate, start, end, asOf, profile } = input;
  const buckets = monthBuckets(start, end);
  const n = buckets.length;
  const weights = spreadWeights(profile, n);
  const cum = cumulative(weights); // length n+1, cum[0]=0 .. cum[n]=1

  // The current period is the last bucket whose start is on/before today; −1 if today precedes the window.
  let nowIndex = -1;
  for (let i = 0; i < n; i++) if (buckets[i]! <= asOf) nowIndex = i;
  const cumNow = nowIndex >= 0 ? cum[nowIndex + 1]! : 0; // planned fraction elapsed by end of current period
  const remaining = 1 - cumNow;

  const periods: ForecastPeriod[] = buckets.map((periodStart, i) => {
    const planned = bac * cum[i + 1]!;
    const isCurrentOrPast = i <= nowIndex;
    const actual = isCurrentOrPast && cumNow > 0 ? actualToDate * (cum[i + 1]! / cumNow) : null;
    const forecast =
      i < nowIndex ? null
      : remaining <= 1e-9 ? (i === nowIndex ? eac : null) // window fully elapsed: forecast collapses to EAC at now
      : actualToDate + (eac - actualToDate) * ((cum[i + 1]! - cumNow) / remaining);
    return { periodStart, label: MONTH_LABEL(periodStart), planned, actual, forecast, isNow: i === nowIndex };
  });

  return {
    periods,
    bac,
    eac,
    vac: bac - eac,
    plannedToDate: bac * cumNow,
    actualToDate,
    nowIndex,
    profile,
  };
}
