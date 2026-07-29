/**
 * VELOCITY ENGINE — derive a team's throughput/velocity STATISTICS from a per-period history, and the
 * optimistic / likely / pessimistic velocity anchors a backlog forecast needs (roadmap §4.7 reporting; the
 * velocity report def already ships, but nothing computed velocity FROM history). This closes the loop the
 * other flow engines leave open: `flow-metrics` emits per-period THROUGHPUT, this turns a throughput series
 * into mean / median / rolling / spread + a predictability score, and its `anchors` feed straight into
 * `pi-forecast`'s `velocity` / `optimisticVelocity` / `pessimisticVelocity` inputs (that engine takes velocity
 * as a given — this is where the given comes from).
 *
 * Pure, no I/O. REUSES the `num` guarded helpers (`finiteValues` / `finiteAvg` for the divide-by-zero-safe
 * mean, `clamp`, `round2`) rather than re-deriving coercion; adds no series-building of its own beyond the
 * stats. DETERMINISTIC: no `Date`, no `Math.random`; the median sorts a copy, the rolling window is a fixed
 * trailing mean. Validation-first and fail-closed: each throughput value is coerced and a negative clamps to
 * 0, a dirty entry contributes 0, the coefficient of variation is null when the mean is 0 (never NaN), every
 * divide is guarded — it never throws. Empty ⇒ zeroed.
 */
import { numLoose, finiteValues, round2, clamp } from "./num";

export interface VelocityInput {
  /** Per-period throughput (items or points completed each period), oldest → newest. */
  throughput: number[];
  /** Trailing window for the rolling average + the "recent" velocity. Coerced; clamped to ≥ 1. Default 3. */
  window?: number;
}

export interface VelocityResult {
  /** Number of periods in the history. */
  count: number;
  /** Mean velocity per period (0 when no periods). */
  mean: number;
  /** Median velocity (0 when no periods). */
  median: number;
  min: number;
  max: number;
  /** Population standard deviation of the per-period velocity (0 when < 2 periods). */
  stdDev: number;
  /** Trailing rolling-average series (same length as the history). */
  rolling: number[];
  /** Mean of the last `window` periods — the "recent" velocity. */
  recent: number;
  /** stdDev / mean — the spread relative to the mean; null when the mean is 0. Lower = steadier. */
  coefficientOfVariation: number | null;
  /** Predictability score 0–1 = clamp(1 − CoV, 0, 1); null when the mean is 0. Higher = steadier. */
  predictability: number | null;
  /** Velocity anchors for a backlog forecast — feed `pi-forecast` directly. */
  anchors: { optimistic: number; likely: number; pessimistic: number };
}

/** Population standard deviation of finite values (0 when fewer than 2). */
function stdDevOf(values: readonly number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / values.length;
  return Math.sqrt(variance);
}

/** Median of a numeric list (assumes non-empty); sorts a copy so the input order is preserved. */
function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Compute velocity statistics + forecast anchors from a throughput history. Each throughput value is coerced
 * and floored at 0. Deterministic, fail-closed, empty ⇒ zeroed (anchors all 0, CoV/predictability null).
 */
export function computeVelocity(input: VelocityInput): VelocityResult {
  const window = Math.max(1, Math.floor(numLoose(input?.window ?? 3)));
  // Coerce every entry (finite, ≥ 0). Non-finite entries become 0 rather than dropping a period.
  const series = (Array.isArray(input?.throughput) ? input.throughput : []).map((v) => Math.max(0, numLoose(v)));

  if (!series.length) {
    return {
      count: 0, mean: 0, median: 0, min: 0, max: 0, stdDev: 0, rolling: [], recent: 0,
      coefficientOfVariation: null, predictability: null,
      anchors: { optimistic: 0, likely: 0, pessimistic: 0 },
    };
  }

  const mean = series.reduce((s, v) => s + v, 0) / series.length;
  const median = medianOf(series);
  const min = Math.min(...series);
  const max = Math.max(...series);
  const stdDev = stdDevOf(series, mean);

  // Trailing rolling average: each point is the mean of up to `window` preceding values (inclusive).
  const rolling = series.map((_, i) => {
    const slice = series.slice(Math.max(0, i - window + 1), i + 1);
    return round2(finiteValues(slice).reduce((s, v) => s + v, 0) / slice.length); // slice length ≥ 1
  });
  const recentSlice = series.slice(Math.max(0, series.length - window));
  const recent = recentSlice.reduce((s, v) => s + v, 0) / recentSlice.length;

  const coefficientOfVariation = mean > 0 ? round2(stdDev / mean) : null;
  const predictability = mean > 0 ? round2(clamp(1 - stdDev / mean, 0, 1)) : null;

  return {
    count: series.length,
    mean: round2(mean),
    median: round2(median),
    min: round2(min),
    max: round2(max),
    stdDev: round2(stdDev),
    rolling,
    recent: round2(recent),
    coefficientOfVariation,
    predictability,
    // Likely = mean; the band is one standard deviation either side, pessimistic floored at 0.
    anchors: {
      optimistic: round2(mean + stdDev),
      likely: round2(mean),
      pessimistic: round2(Math.max(0, mean - stdDev)),
    },
  };
}
