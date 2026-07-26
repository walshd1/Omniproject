/**
 * PERT THREE-POINT ESTIMATING ENGINE — the beta-distribution estimate that turns a guess into a
 * distribution with a variance you can roll up.
 *
 * A single-point duration/effort estimate hides its own uncertainty. PERT (Program Evaluation and
 * Review Technique) asks the estimator for three points instead — optimistic, most-likely,
 * pessimistic — and reads them as a beta distribution:
 *
 *   mean     = (o + 4·m + p) / 6      — the expected value, weighting the mode four-to-one
 *   stdDev   = (p − o) / 6            — the spread, one-sixth of the full range
 *   variance = stdDev²                — the additive quantity (see rollup)
 *
 * The point of the variance is that it ADDS across independent tasks while the standard deviation does
 * not: a chain's mean is the sum of task means, its variance is the sum of task variances, and its
 * standard deviation is the square root of that summed variance — never the sum of the task standard
 * deviations. {@link rollupPert} does exactly that, from RAW per-task values so rounding never compounds
 * through the fold.
 *
 * VALIDATION FIRST — an estimate is only used when its three points are finite and correctly ordered
 * (o ≤ m ≤ p); anything else would make stdDev negative or the mean meaningless. Invalid estimates are
 * reported (`valid: false`, null stats) rather than thrown or silently clamped, so a bad row is visible
 * instead of poisoning a roll-up; {@link rollupPert} simply skips them and counts what it used. Same
 * discipline as run-rate.ts / evm.ts: compute from raw inputs, round only the returned scalars (to 4 dp),
 * and never emit NaN/±Infinity. Pure, no I/O.
 */

/** Round to 4 decimal places (durations / effort / their spreads). */
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

export interface PertEstimateInput {
  /** Optimistic (best-case) estimate — the floor of the range. */
  optimistic: number;
  /** Most-likely (modal) estimate — weighted four-to-one in the mean. */
  mostLikely: number;
  /** Pessimistic (worst-case) estimate — the ceiling of the range. */
  pessimistic: number;
}

export interface PertEstimateResult {
  optimistic: number;
  mostLikely: number;
  pessimistic: number;
  /** Whether the three points were finite and correctly ordered (o ≤ m ≤ p). */
  valid: boolean;
  /** (o + 4·m + p) / 6 — the expected value. `null` when the estimate is invalid. */
  mean: number | null;
  /** (p − o) / 6 — the spread. `null` when invalid. */
  stdDev: number | null;
  /** stdDev² — the additive quantity for roll-ups. `null` when invalid. */
  variance: number | null;
}

export interface PertRollupResult {
  /** How many of the supplied estimates were valid and included in the roll-up. */
  count: number;
  /** Σ of the task means. `null` when no estimate was valid. */
  mean: number | null;
  /** Σ of the task variances. `null` when no estimate was valid. */
  variance: number | null;
  /** sqrt(Σ variances) — the chain spread. `null` when no estimate was valid. */
  stdDev: number | null;
}

/** A confidence band around a mean: [mean − z·stdDev, mean + z·stdDev]. */
export interface PertInterval {
  low: number;
  high: number;
}

/** Raw (unrounded) PERT statistics for one estimate, or `null` when the estimate is invalid. */
interface RawPert {
  mean: number;
  stdDev: number;
  variance: number;
}

/**
 * The validity gate + raw statistics for a single three-point estimate. Returns `null` when any point is
 * non-finite or the points are mis-ordered (o ≤ m ≤ p is required) — the one place the ordering/finite
 * rule is enforced, shared by {@link computePertEstimate} and {@link rollupPert}.
 */
function rawPert(input: PertEstimateInput): RawPert | null {
  const { optimistic: o, mostLikely: m, pessimistic: p } = input;
  if (!Number.isFinite(o) || !Number.isFinite(m) || !Number.isFinite(p)) return null;
  if (!(o <= m && m <= p)) return null;
  const mean = (o + 4 * m + p) / 6; // divisor is the constant 6 — never zero
  const stdDev = (p - o) / 6; // ≥ 0 because p ≥ o is enforced above
  return { mean, stdDev, variance: stdDev * stdDev };
}

/**
 * Compute the PERT mean, standard deviation and variance for a single three-point estimate. Invalid
 * input (non-finite or mis-ordered) yields `valid: false` with null statistics rather than a throw.
 */
export function computePertEstimate(input: PertEstimateInput): PertEstimateResult {
  const raw = rawPert(input);
  return {
    optimistic: round4(input.optimistic),
    mostLikely: round4(input.mostLikely),
    pessimistic: round4(input.pessimistic),
    valid: raw !== null,
    mean: raw === null ? null : round4(raw.mean),
    stdDev: raw === null ? null : round4(raw.stdDev),
    variance: raw === null ? null : round4(raw.variance),
  };
}

/**
 * Roll a set of independent three-point estimates into a chain estimate: mean = Σ task means, variance =
 * Σ task variances, stdDev = sqrt(that summed variance). Invalid estimates are skipped (not thrown); the
 * returned `count` is how many were actually included. An empty set — or one with no valid estimate —
 * yields a zero count and null statistics. Summed from RAW per-task values so rounding never compounds.
 */
export function rollupPert(inputs: readonly PertEstimateInput[]): PertRollupResult {
  let count = 0;
  let sumMean = 0;
  let sumVariance = 0;
  for (const input of inputs) {
    const raw = rawPert(input);
    if (raw === null) continue;
    count += 1;
    sumMean += raw.mean;
    sumVariance += raw.variance;
  }
  if (count === 0) return { count: 0, mean: null, variance: null, stdDev: null };
  return {
    count,
    mean: round4(sumMean),
    variance: round4(sumVariance),
    stdDev: round4(Math.sqrt(sumVariance)), // sumVariance ≥ 0 (each variance ≥ 0) — sqrt is real
  };
}

/**
 * A symmetric confidence band around a mean, mean ± z·stdDev, for a z-score (≈1.645 for 90%, ≈1.96 for
 * 95%). Returns `null` when either input or z is non-finite, or when stdDev is negative (never valid).
 * Endpoints are rounded to 4 dp. Pure arithmetic — no division, no distribution table.
 */
export function pertInterval(mean: number, stdDev: number, z: number): PertInterval | null {
  if (!Number.isFinite(mean) || !Number.isFinite(stdDev) || !Number.isFinite(z)) return null;
  if (stdDev < 0) return null;
  const half = z * stdDev;
  return { low: round4(mean - half), high: round4(mean + half) };
}
