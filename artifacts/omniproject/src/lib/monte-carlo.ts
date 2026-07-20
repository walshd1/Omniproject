/**
 * Monte Carlo schedule/effort-risk simulation — a STATELESS quantitative-risk engine.
 *
 * Enterprise PPM tools (Primavera Risk, Acumen) quantify "what's the chance we finish on plan?" by
 * sampling each task's duration thousands of times from an uncertainty distribution and reading the
 * spread of the totals. OmniProject can do this **without storing anything**: it derives the inputs
 * from the existing read-model (each work item's estimate) and computes the distribution on the fly.
 *
 * The single-point estimate a backend usually holds becomes a **right-skewed triangular** (work
 * overruns more often than it underruns): optimistic = e·(1−u), most-likely = e, pessimistic =
 * e·(1+2u) for an uncertainty fraction u. So the naive "sum of estimates" turns out to be roughly the
 * P30–P40, not the P50 — the classic insight a PMO needs. Sensitivity (a tornado) ranks which tasks
 * drive the variance, by correlating each task's sampled duration with the simulated total.
 *
 * Pure + deterministic given an injected `rng`, so it's fully unit-testable; defaults to Math.random.
 */

export interface RiskTask {
  id: string;
  label: string;
  /** Single-point estimate (hours/days — unit-agnostic). Non-positive tasks are ignored. */
  estimate: number;
}

export interface SimOptions {
  /** Simulation runs (default 2000; clamped to [200, 20000]). */
  iterations?: number;
  /** Uncertainty fraction u (default 0.3 ⇒ optimistic 0.7×, pessimistic 1.6×). Clamped to [0.05, 1]. */
  uncertainty?: number;
  /** Injectable RNG in [0,1) for determinism in tests. Defaults to Math.random. */
  rng?: () => number;
}

export interface SimResult {
  iterations: number;
  /** Sum of the raw single-point estimates — the naive plan. */
  deterministic: number;
  mean: number;
  /** Confidence levels: there's an X% chance the total is ≤ pXX. */
  p10: number; p50: number; p80: number; p90: number;
  min: number; max: number;
  /** The probability `deterministic` is achieved (where the naive plan sits on the S-curve), 0–1. */
  planConfidence: number;
  /** S-curve: cumulative probability the total is ≤ `value`. */
  curve: { value: number; probability: number }[];
  /** Tornado: tasks ranked by |correlation| of their duration to the total (variance drivers). */
  sensitivity: { id: string; label: string; correlation: number }[];
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Inverse-CDF sample from a triangular(o, m, p) given a uniform u01. */
function triangular(o: number, m: number, p: number, u01: number): number {
  if (p === o) return o;
  const fc = (m - o) / (p - o);
  return u01 < fc
    ? o + Math.sqrt(u01 * (p - o) * (m - o))
    : p - Math.sqrt((1 - u01) * (p - o) * (p - m));
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

/** Count of ascending-sorted values ≤ x (upper-bound index) — an O(log n) replacement for a filter+length. */
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

/** Run the simulation over the tasks. Tasks with a non-positive estimate are dropped. */
export function simulate(tasks: RiskTask[], options: SimOptions = {}): SimResult {
  const iterations = Math.round(clamp(options.iterations ?? 2000, 200, 20000));
  const u = clamp(options.uncertainty ?? 0.3, 0.05, 1);
  const rng = options.rng ?? Math.random;
  const live = tasks.filter((t) => t.estimate > 0);
  const deterministic = live.reduce((s, t) => s + t.estimate, 0);

  if (live.length === 0) {
    return { iterations, deterministic: 0, mean: 0, p10: 0, p50: 0, p80: 0, p90: 0, min: 0, max: 0, planConfidence: 1, curve: [], sensitivity: [] };
  }

  const totals: number[] = new Array(iterations);
  // Per-task sampled series, for the sensitivity (tornado) correlation.
  const perTask: number[][] = live.map(() => new Array(iterations));

  for (let i = 0; i < iterations; i++) {
    let total = 0;
    for (let t = 0; t < live.length; t++) {
      const e = live[t]!.estimate;
      const sample = triangular(e * (1 - u), e, e * (1 + 2 * u), rng());
      perTask[t]![i] = sample;
      total += sample;
    }
    totals[i] = total;
  }

  const sorted = [...totals].sort((a, b) => a - b);
  const mean = totals.reduce((s, v) => s + v, 0) / iterations;
  const min = sorted[0]!, max = sorted[sorted.length - 1]!;
  const belowPlan = countAtMost(sorted, deterministic);

  // S-curve over ~40 evenly-spaced buckets across [min, max]. `sorted` is ascending, so each
  // bucket's cumulative count is an upper-bound index (identical to the old filter+length).
  const BUCKETS = 40;
  const span = max - min || 1;
  const curve = Array.from({ length: BUCKETS + 1 }, (_, k) => {
    const value = min + (span * k) / BUCKETS;
    const probability = countAtMost(sorted, value) / iterations;
    return { value: Math.round(value), probability };
  });

  const sensitivity = live
    .map((t, idx) => ({ id: t.id, label: t.label, correlation: correlation(perTask[idx]!, totals) }))
    .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

  return {
    iterations,
    deterministic: Math.round(deterministic),
    mean: Math.round(mean),
    p10: Math.round(percentile(sorted, 0.1)),
    p50: Math.round(percentile(sorted, 0.5)),
    p80: Math.round(percentile(sorted, 0.8)),
    p90: Math.round(percentile(sorted, 0.9)),
    min: Math.round(min),
    max: Math.round(max),
    planConfidence: belowPlan / iterations,
    curve,
    sensitivity,
  };
}

/** A small seeded PRNG (mulberry32) — for deterministic tests and reproducible report runs. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
