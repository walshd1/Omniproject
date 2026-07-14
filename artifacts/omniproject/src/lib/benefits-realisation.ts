import { convertAmount, isConvertible } from "./currency";
import { round2 } from "./num";
import { summariseBenefits, type BenefitBucket } from "./benefits";
import type { ProjectItems } from "./portfolio-value";

/**
 * Portfolio benefits REALISATION roll-up — the realisation lens the programme-level planned-vs-realised
 * table (rollupBenefits) drops: the benefit pipeline by lifecycle stage measured in *value* (not count),
 * and the realisation trajectory over time (planned benefit value by due date vs realised to date). Pure
 * and derive-only: consolidates each project's benefit rows into one reporting currency. Nothing stored.
 */

/** Lifecycle buckets in board-reading order (realised value first, unrealised risk last). */
export const BUCKET_ORDER: BenefitBucket[] = ["realised", "on_track", "at_risk", "missed", "not_started"];
export const BUCKET_LABEL: Record<BenefitBucket, string> = {
  realised: "Realised", on_track: "On track", at_risk: "At risk", missed: "Missed", not_started: "Not started",
};

export interface BucketValue {
  bucket: BenefitBucket;
  planned: number;
  actual: number;
  count: number;
}

export interface RealisationPipeline {
  buckets: BucketValue[];
  totalPlanned: number;
  totalActual: number;
  /** Planned value sitting in at-risk or missed buckets — the value in jeopardy. */
  atRiskValue: number;
  /** totalActual ÷ totalPlanned × 100 (0 when nothing planned). */
  realisationPct: number;
  /** Projects excluded from the pipeline because their currency has no rate to the reporting
   *  currency (summing the raw foreign amount would corrupt the consolidated value). */
  excludedForFx: number;
}

const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

/** Consolidate every project's benefits into the portfolio pipeline (planned + actual value per bucket). */
export function realisationPipeline(projects: ProjectItems[], reportingCurrency: string, rates?: Record<string, number>): RealisationPipeline {
  const acc: Record<BenefitBucket, BucketValue> = Object.fromEntries(
    BUCKET_ORDER.map((b) => [b, { bucket: b, planned: 0, actual: 0, count: 0 }]),
  ) as Record<BenefitBucket, BucketValue>;
  let totalPlanned = 0;
  let totalActual = 0;
  let excludedForFx = 0;

  for (const p of projects) {
    // Skip FX-unconvertible projects — convertAmount would pass the raw foreign amount through
    // unchanged, corrupting the consolidated value (see portfolio-value / portfolio-finance).
    if (!isConvertible(p.currency, reportingCurrency, rates)) {
      if (summariseBenefits(p.items).rows.length > 0) excludedForFx += 1;
      continue;
    }
    const conv = (n: number) => convertAmount(n, p.currency, reportingCurrency, rates);
    for (const r of summariseBenefits(p.items).rows) {
      const planned = conv(r.planned);
      const actual = conv(r.actual);
      acc[r.bucket].planned += planned;
      acc[r.bucket].actual += actual;
      acc[r.bucket].count += 1;
      totalPlanned += planned;
      totalActual += actual;
    }
  }

  const buckets = BUCKET_ORDER.map((b) => ({ ...acc[b], planned: round2(acc[b].planned), actual: round2(acc[b].actual) }));
  const atRiskValue = round2(acc.at_risk.planned + acc.missed.planned);
  return { buckets, totalPlanned: round2(totalPlanned), totalActual: round2(totalActual), atRiskValue, realisationPct: pct(totalActual, totalPlanned), excludedForFx };
}

// ── Realisation schedule (by benefit due quarter) ─────────────────────────────

interface Quarter { key: string; label: string; start: number; }

/** The calendar quarter (UTC) a timestamp falls in. */
function quarterOf(ms: number): Quarter {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3); // 0..3
  return { key: `${y}-Q${q + 1}`, label: `Q${q + 1} ${String(y).slice(2)}`, start: Date.UTC(y, q * 3, 1) };
}

/** Contiguous quarters from `lo`..`hi` inclusive (capped), so the cumulative curve has no gaps. */
function quartersBetween(lo: number, hi: number, max = 24): Quarter[] {
  const out: Quarter[] = [];
  let cur = quarterOf(lo);
  const end = quarterOf(Math.max(hi, lo)).start;
  while (cur.start <= end && out.length < max) {
    out.push(cur);
    const d = new Date(cur.start);
    cur = quarterOf(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1));
  }
  return out;
}

export interface RealisationPeriod {
  key: string;
  label: string;
  start: number;
  /** Planned benefit value DUE in this quarter. */
  plannedDue: number;
  /** Cumulative planned value due through this quarter (the realisation baseline). */
  cumulativePlanned: number;
  /** Cumulative realised value through this quarter — null for quarters still in the future. */
  cumulativeRealised: number | null;
}

export interface RealisationSchedule {
  periods: RealisationPeriod[];
  /** Planned value that should be realised by now (benefits due on/before today). */
  plannedToDate: number;
  /** Actual realised value for benefits due on/before today. */
  realisedToDate: number;
  /** plannedToDate − realisedToDate (≥0): the realisation gap so far. */
  shortfallToDate: number;
  /** Planned value of overdue benefits not yet fully realised — the slippage. */
  overdueUnrealised: number;
  /** Planned value that carries no due date and so can't be scheduled. */
  undated: number;
  totalPlanned: number;
  /** Projects excluded from the trajectory because their currency has no rate to the reporting
   *  currency (summing the raw foreign amount would corrupt the consolidated value). */
  excludedForFx: number;
}

/** Build the realisation trajectory: planned benefit value bucketed by due quarter vs realised to date. */
export function realisationSchedule(
  projects: ProjectItems[],
  reportingCurrency: string,
  rates: Record<string, number> | undefined,
  asOf: number,
): RealisationSchedule {
  const dated: { due: number; planned: number; actual: number }[] = [];
  let undated = 0;
  let totalPlanned = 0;
  let excludedForFx = 0;

  for (const p of projects) {
    // Skip FX-unconvertible projects — their raw foreign amounts would corrupt the trajectory.
    if (!isConvertible(p.currency, reportingCurrency, rates)) {
      if (summariseBenefits(p.items).rows.length > 0) excludedForFx += 1;
      continue;
    }
    const conv = (n: number) => convertAmount(n, p.currency, reportingCurrency, rates);
    for (const r of summariseBenefits(p.items).rows) {
      const planned = conv(r.planned);
      const actual = conv(r.actual);
      totalPlanned += planned;
      const due = r.benefitDueDate ? Date.parse(r.benefitDueDate) : NaN;
      if (Number.isNaN(due)) undated += planned;
      else dated.push({ due, planned, actual });
    }
  }

  if (!dated.length) {
    return { periods: [], plannedToDate: 0, realisedToDate: 0, shortfallToDate: 0, overdueUnrealised: 0, undated: round2(undated), totalPlanned: round2(totalPlanned), excludedForFx };
  }

  const lo = Math.min(...dated.map((d) => d.due));
  const hi = Math.max(...dated.map((d) => d.due), asOf);
  const quarters = quartersBetween(lo, hi);

  let cumPlanned = 0;
  let cumRealised = 0;
  const periods: RealisationPeriod[] = quarters.map((q, i) => {
    const nextStart = quarters[i + 1]?.start ?? Infinity;
    const inQ = dated.filter((d) => d.due >= q.start && d.due < nextStart);
    const plannedDue = inQ.reduce((s, d) => s + d.planned, 0);
    cumPlanned += plannedDue;
    cumRealised += inQ.reduce((s, d) => s + d.actual, 0);
    // Realised is only knowable up to today; future quarters show no realised line.
    const future = q.start > asOf;
    return { key: q.key, label: q.label, start: q.start, plannedDue: round2(plannedDue), cumulativePlanned: round2(cumPlanned), cumulativeRealised: future ? null : round2(cumRealised) };
  });

  const dueByNow = dated.filter((d) => d.due <= asOf);
  const plannedToDate = dueByNow.reduce((s, d) => s + d.planned, 0);
  const realisedToDate = dueByNow.reduce((s, d) => s + d.actual, 0);
  const overdueUnrealised = dated.filter((d) => d.due < asOf).reduce((s, d) => s + Math.max(0, d.planned - d.actual), 0);

  return {
    periods,
    plannedToDate: round2(plannedToDate),
    realisedToDate: round2(realisedToDate),
    shortfallToDate: round2(Math.max(0, plannedToDate - realisedToDate)),
    overdueUnrealised: round2(overdueUnrealised),
    undated: round2(undated),
    totalPlanned: round2(totalPlanned),
    excludedForFx,
  };
}
