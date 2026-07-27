/**
 * CYCLE-TIME / LEAD-TIME DISTRIBUTION ENGINE — the flow-time half of agile reporting: how long work actually
 * takes, as a DISTRIBUTION not a single average (roadmap §4.3 / §5.5). CYCLE TIME is the active span a done
 * item spent in progress (startedAt → completedAt); LEAD TIME is the whole wait a requester saw (createdAt →
 * completedAt). The api-server trend engine reports a MEAN `cycleTimeDays` above the seam; this is the
 * below-seam engine that returns the full spread — mean, median and the p50 / p85 / p95 percentiles a team
 * quotes as a Service-Level-Expectation ("85% of items finish within N days"). It completes the flow suite
 * alongside `flow-metrics` (burn/CFD), `sprint-metrics` (sprint review) and `velocity` (throughput stats).
 *
 * REUSES the shipped `work-vocabulary` status axis (`statusClassOf` → only DONE items have a finished flow
 * time) and the `num` guarded helpers; the percentile is the same nearest-rank idiom `monte-carlo.ts` uses.
 * Pure, no I/O, DETERMINISTIC: it never calls `Date` — all timestamps are epoch-ms numbers passed in, and the
 * percentile sorts a copy. The ms→days divide is by a fixed constant (never NaN/±Infinity). Validation-first
 * and fail-closed: ids coerced, non-object items dropped, a non-done item or one missing the needed
 * timestamps is skipped for that metric, a negative span clamps to 0 — it never throws. Empty ⇒ a zero-count
 * distribution with null stats.
 */
import { statusClassOf } from "./work-vocabulary";
import { optNum, round2 } from "./num";

const MS_PER_DAY = 86_400_000;

export interface CycleTimeItem {
  id: string;
  /** Work-item status; only a `done`-class item has a completed flow time. */
  status?: string | null;
  /** When it entered scope (epoch ms) — the lead-time start. */
  createdAt?: number | null;
  /** When work started (epoch ms) — the cycle-time start. */
  startedAt?: number | null;
  /** When it completed (epoch ms) — the end of both spans. */
  completedAt?: number | null;
}

/** A flow-time distribution in DAYS. All stats are null when no item qualified. */
export interface Distribution {
  /** Items that contributed a value. */
  count: number;
  mean: number | null;
  median: number | null;
  /** 50th / 85th / 95th percentiles — the 85th is the usual Service-Level-Expectation. */
  p50: number | null;
  p85: number | null;
  p95: number | null;
  min: number | null;
  max: number | null;
  /** Population standard deviation. */
  stdDev: number | null;
}

export interface CycleTimeResult {
  /** Active in-progress span (startedAt → completedAt) over done items that have both. */
  cycleTime: Distribution;
  /** End-to-end span (createdAt → completedAt) over done items that have both. */
  leadTime: Distribution;
  /** Done items considered (had a completedAt). */
  doneItems: number;
}

/** Coerce a value to a stable string id (non-blank string, or a finite number), else null. */
function coerceId(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Nearest-rank percentile on an ascending-sorted array (the `monte-carlo.ts` convention). */
function percentile(sorted: readonly number[], q: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[idx]!;
}

/** Build a distribution (days) from a value list. Empty ⇒ zero count, null stats. */
function distribution(values: readonly number[]): Distribution {
  if (!values.length) return { count: 0, mean: null, median: null, p50: null, p85: null, p95: null, min: null, max: null, stdDev: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.length > 1 ? values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / values.length : 0;
  return {
    count: values.length,
    mean: round2(mean),
    median: round2(percentile(sorted, 0.5)),
    p50: round2(percentile(sorted, 0.5)),
    p85: round2(percentile(sorted, 0.85)),
    p95: round2(percentile(sorted, 0.95)),
    min: round2(sorted[0]!),
    max: round2(sorted[sorted.length - 1]!),
    stdDev: round2(Math.sqrt(variance)),
  };
}

/**
 * Compute cycle-time + lead-time distributions over a set of work items. Only done items with the needed
 * timestamps contribute. All timestamps are epoch-ms supplied by the caller. Deterministic, fail-closed,
 * empty ⇒ zero-count distributions.
 */
export function computeCycleTime(items: readonly CycleTimeItem[]): CycleTimeResult {
  const cycleValues: number[] = [];
  const leadValues: number[] = [];
  let doneItems = 0;

  if (Array.isArray(items)) {
    for (const raw of items) {
      if (raw === null || typeof raw !== "object") continue;
      const it = raw as CycleTimeItem;
      if (coerceId(it.id) === null) continue;
      if (statusClassOf(typeof it.status === "string" ? it.status : "") !== "done") continue;
      const completedAt = optNum(it.completedAt);
      if (completedAt === null) continue; // a done item with no completion time can't be timed
      doneItems++;

      const startedAt = optNum(it.startedAt);
      if (startedAt !== null) cycleValues.push(Math.max(0, (completedAt - startedAt) / MS_PER_DAY));
      const createdAt = optNum(it.createdAt);
      if (createdAt !== null) leadValues.push(Math.max(0, (completedAt - createdAt) / MS_PER_DAY));
    }
  }

  return {
    cycleTime: distribution(cycleValues),
    leadTime: distribution(leadValues),
    doneItems,
  };
}
