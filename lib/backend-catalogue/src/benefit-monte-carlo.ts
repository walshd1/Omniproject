/**
 * BENEFIT / VALUE MONTE-CARLO — a STATELESS quantitative-risk engine for the VALUE side of the portfolio
 * (roadmap §4.3, "Monte Carlo on schedule + cost + benefit"). Its sibling monte-carlo.ts answers the SCHEDULE
 * question ("what's the chance we finish on plan?") by sampling task durations; this module answers the VALUE
 * question ("what's the chance the portfolio actually pays off?") by sampling each initiative's benefit and cost
 * and reading the spread of the net value delivered. Together they cover the two halves §4.3 asks for.
 *
 * The single-point benefit/cost estimate a backend holds becomes a **right-skewed triangular** — value is
 * optimistic more often than it is pessimistic, and cost overruns more often than it undershoots — so the naive
 * "benefit minus cost" sits well above the median outcome. The engine surfaces the decision-grade facts a PMO
 * needs that a point estimate hides: the probability the portfolio clears break-even or a target return, the
 * downside (a value-at-risk P10), the full S-curve, and a tornado ranking which initiatives drive the variance.
 *
 * Deterministic given an injected `rng` (reuse the exported {@link mulberry32} seed for reproducible runs), so it
 * is fully unit-testable; defaults to Math.random like its sibling. Pure, no I/O, vendor-neutral — plain records
 * in, plain result out — so it lives below the broker seam and is shared by every surface. Validation first:
 * every input is coerced to a finite number via numLoose (a dirty read can't produce NaN), uncertainty and
 * iteration counts are clamped to sane bounds, and an empty portfolio yields a well-defined zero result.
 */
import { numLoose, clamp } from "./num";
import { mulberry32 } from "./monte-carlo";

/** Round to 4 decimal places (probabilities/correlations). */
const round4 = (n: number): number => Math.round(n * 10000) / 10000;
/** Round to 2 decimal places (monetary values). */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A stable ascending-id comparator — the deterministic tiebreak (no Math.random). */
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface BenefitInitiative {
  id: string;
  /** Point-estimate benefit (value delivered). Coerced to a finite number. */
  benefit: number;
  /** Point-estimate cost (default 0). Coerced to a finite number. */
  cost?: number;
  /** Per-initiative uncertainty fraction override; falls back to the sim-wide default when absent. */
  uncertainty?: number;
}

export interface BenefitSimOptions {
  /** Simulation runs (default 2000; clamped to [200, 20000]). */
  iterations?: number;
  /** Uncertainty fraction u (default 0.3 ⇒ optimistic 0.7×, pessimistic 1.6×). Clamped to [0.05, 1]. */
  uncertainty?: number;
  /** Net-value target the portfolio is judged against (default 0 ⇒ break-even). */
  target?: number;
  /** Injectable RNG in [0,1) for determinism in tests. Defaults to Math.random. */
  rng?: () => number;
}

export interface BenefitSimResult {
  iterations: number;
  /** Σ(benefit − cost) at the point estimates — the naive plan. */
  deterministic: number;
  mean: number;
  /** Confidence levels on net value: there's an X% chance net is ≤ pXX. */
  p10: number; p50: number; p80: number; p90: number;
  min: number; max: number;
  /** Probability net value ≥ 0 (the portfolio at least breaks even), 0–1. */
  probabilityPositive: number;
  /** Probability net value ≥ `target`, 0–1. */
  probabilityOfTarget: number;
  /** Downside value-at-risk: the P10 net value ("90% confident net is at least this"). */
  valueAtRisk: number;
  /** S-curve: cumulative probability net value is ≤ `value`. */
  curve: { value: number; probability: number }[];
  /** Tornado: initiatives ranked by |correlation| of their net contribution to the total (value drivers). */
  sensitivity: { id: string; correlation: number }[];
}

/** Inverse-CDF sample from a triangular(o, m, p) given a uniform u01. */
function triangular(o: number, m: number, p: number, u01: number): number {
  if (p === o) return o;
  const fc = (m - o) / (p - o);
  return u01 < fc
    ? o + Math.sqrt(u01 * (p - o) * (m - o))
    : p - Math.sqrt((1 - u01) * (p - o) * (p - m));
}

/**
 * Sample a right-skewed triangular around a point estimate `e` at uncertainty `u`. A non-negative estimate skews
 * up (benefit optimism); the caller negates for cost so cost skews toward overrun. Uses the estimate's own sign so
 * a zero estimate stays zero and the spread is proportional to magnitude.
 */
function skew(e: number, u: number, u01: number): number {
  const mag = Math.abs(e);
  const sample = triangular(mag * (1 - u), mag, mag * (1 + 2 * u), u01);
  return e < 0 ? -sample : sample;
}

/** Pearson correlation of two equal-length series (0 when either is constant). */
function correlation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n === 0) return 0;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]!; sy += ys[i]!; }
  const mx = sx / n, my = sy / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx, dy = ys[i]! - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  const denom = Math.sqrt(sxx * syy);
  return denom === 0 ? 0 : sxy / denom;
}

/** Count of ascending-sorted values ≤ x (upper-bound index). */
const countAtMost = (sorted: number[], x: number): number => {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

const percentile = (sorted: number[], q: number): number => {
  if (sorted.length === 0) return 0;
  const idx = clamp(Math.floor(q * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[idx]!;
};

/**
 * Simulate the portfolio's net-value distribution. Each initiative's benefit and cost are sampled from a
 * right-skewed triangular around their point estimates; net = Σ(benefit − cost) per run. Empty portfolio ⇒ a
 * well-defined zero result (break-even with certainty; the target is met iff it is ≤ 0).
 */
export function simulateBenefit(initiatives: readonly BenefitInitiative[], options: BenefitSimOptions = {}): BenefitSimResult {
  const iterations = Math.round(clamp(numLoose(options.iterations ?? 2000), 200, 20000));
  const uDefault = clamp(numLoose(options.uncertainty ?? 0.3), 0.05, 1);
  const target = numLoose(options.target);
  const rng = options.rng ?? Math.random;

  const live = initiatives.map((it) => ({
    id: String(it.id),
    benefit: numLoose(it.benefit),
    cost: numLoose(it.cost),
    u: it.uncertainty === undefined ? uDefault : clamp(numLoose(it.uncertainty), 0.05, 1),
  }));
  const deterministic = live.reduce((s, it) => s + (it.benefit - it.cost), 0);

  if (live.length === 0) {
    return {
      iterations, deterministic: 0, mean: 0, p10: 0, p50: 0, p80: 0, p90: 0, min: 0, max: 0,
      probabilityPositive: 1, probabilityOfTarget: target <= 0 ? 1 : 0, valueAtRisk: 0, curve: [], sensitivity: [],
    };
  }

  const totals: number[] = new Array(iterations);
  // Per-initiative sampled net contribution, for the sensitivity (tornado) correlation.
  const perInit: number[][] = live.map(() => new Array(iterations));

  for (let i = 0; i < iterations; i++) {
    let total = 0;
    for (let t = 0; t < live.length; t++) {
      const it = live[t]!;
      const netContribution = skew(it.benefit, it.u, rng()) - skew(it.cost, it.u, rng());
      perInit[t]![i] = netContribution;
      total += netContribution;
    }
    totals[i] = total;
  }

  const sorted = [...totals].sort((a, b) => a - b);
  const mean = totals.reduce((s, v) => s + v, 0) / iterations;
  const min = sorted[0]!, max = sorted[sorted.length - 1]!;

  const BUCKETS = 40;
  const span = max - min || 1;
  const curve = Array.from({ length: BUCKETS + 1 }, (_, k) => {
    const value = min + (span * k) / BUCKETS;
    return { value: round2(value), probability: round4(countAtMost(sorted, value) / iterations) };
  });

  const sensitivity = live
    .map((it, idx) => ({ id: it.id, correlation: round4(correlation(perInit[idx]!, totals)) }))
    .sort((a, b) => (Math.abs(b.correlation) !== Math.abs(a.correlation) ? Math.abs(b.correlation) - Math.abs(a.correlation) : byId(a.id, b.id)));

  return {
    iterations,
    deterministic: round2(deterministic),
    mean: round2(mean),
    p10: round2(percentile(sorted, 0.1)),
    p50: round2(percentile(sorted, 0.5)),
    p80: round2(percentile(sorted, 0.8)),
    p90: round2(percentile(sorted, 0.9)),
    min: round2(min),
    max: round2(max),
    probabilityPositive: round4((iterations - countAtMost(sorted, -1e-9)) / iterations),
    probabilityOfTarget: round4((iterations - countAtMost(sorted, target - 1e-9)) / iterations),
    valueAtRisk: round2(percentile(sorted, 0.1)),
    curve,
    sensitivity,
  };
}
