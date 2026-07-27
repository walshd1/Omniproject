/**
 * FLOW-METRICS ENGINE — a pure, STATELESS builder for the agile delivery-flow series a progress report needs:
 * BURN-DOWN (remaining work vs an ideal line), BURN-UP (completed vs scope, so scope-change is visible), a
 * per-status-class CUMULATIVE-FLOW diagram (backlog / active / done lanes), and THROUGHPUT per period (roadmap
 * §4.7, "Baseline vs actual variance + EVM — EVM engine ✅; burn-up/down + cumulative flow remain"). The SPA's
 * `progress-charts.ts` builds a TWO-band (total/completed) series above the seam from broker history; this is
 * the below-seam canonical engine, and it reconstructs a richer PER-STATE flow from each item's lifecycle
 * timestamps, so a real CFD (not just done-vs-remaining) falls out.
 *
 * Period-agnostic by construction like `capacity.ts`: the caller supplies the ordered period boundaries (epoch
 * ms) — nothing hardcodes a calendar, and no `Date` is ever called, so a run and its test are reproducible.
 * State at a boundary is reconstructed from timestamps: an item is in scope once `createdAt ≤ t` (absent ⇒ in
 * scope throughout), DONE once `completedAt ≤ t`, ACTIVE once `startedAt ≤ t` (and not yet done), else BACKLOG;
 * a cancelled item leaves scope entirely. Work is measured by item COUNT or by story POINTS (caller's choice).
 *
 * REUSES the shipped `work-vocabulary` status axis (`statusClassOf` → open/active/done/cancelled — the same
 * lifecycle classes the board keys off) and the `num` guarded-coercion helpers; mirrors `capacity` (caller
 * period axis) + `task-workload` (validation-first, summary roll-up). Fail-closed: ids coerced, non-object
 * items dropped, dirty/absent timestamps + points handled, every divide guarded (the ideal-line slope is 0
 * when there is one period; percentages are null when scope is 0) — it never throws. Empty ⇒ empty.
 */
import { statusClassOf } from "./work-vocabulary";
import { numLoose, optNum, round2, round1 } from "./num";

/** One work item, read defensively. Only `id` is required. */
export interface FlowItem {
  id: string;
  /** Work-item status; its lifecycle class decides cancellation (a cancelled item leaves scope). */
  status?: string | null;
  /** When it entered scope (epoch ms). Absent ⇒ in scope throughout the window. */
  createdAt?: number | null;
  /** When work started (epoch ms) — the backlog→active transition. Absent ⇒ no active phase. */
  startedAt?: number | null;
  /** When it completed (epoch ms) — the active→done transition. Absent ⇒ never shows as done in the series. */
  completedAt?: number | null;
  /** Story points / estimate; used when weighing by "points". Absent/dirty ⇒ 0. */
  points?: number | null;
}

export interface FlowMetricsOptions {
  /** Ordered period boundaries as epoch ms — the series x-axis. Coerced, de-duplicated and sorted ascending. */
  periods: number[];
  /** Weigh work by item count (default) or by summed story points. */
  weightBy?: "count" | "points";
}

export interface FlowPoint {
  /** The period boundary (epoch ms). */
  period: number;
  /** Total in-scope work by this boundary (grows when scope is added). */
  scope: number;
  /** Completed (done) work by this boundary. */
  completed: number;
  /** scope − completed. */
  remaining: number;
  /** The ideal burn-down value at this boundary (linear from the opening scope to 0). */
  ideal: number;
  /** CFD lane: in scope, not started. */
  backlog: number;
  /** CFD lane: started, not done. */
  active: number;
  /** CFD lane: done (== completed). */
  done: number;
  /** Work completed WITHIN this period bucket (the throughput for the bucket). */
  throughput: number;
}

export interface FlowMetricsResult {
  points: FlowPoint[];
  summary: {
    /** In-scope work at the final boundary. */
    totalScope: number;
    /** Completed work at the final boundary. */
    totalCompleted: number;
    /** totalScope − totalCompleted. */
    remaining: number;
    /** Sum of per-bucket throughput. */
    throughputTotal: number;
    /** Mean throughput per period (0 when there are no periods). */
    meanThroughput: number;
    /** Percent complete at the final boundary (null when scope is 0). */
    percentComplete: number | null;
  };
}

/** One item resolved to the fields the reconstruction keys off. */
interface Resolved {
  createdAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  measure: number;
}

/** Coerce a value to a stable string id (non-blank string, or a finite number), else null. */
function coerceId(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * Build the delivery-flow series over the caller's period boundaries. State at each boundary is reconstructed
 * from item lifecycle timestamps; work is measured by count or points. Deterministic, fail-closed, empty ⇒
 * empty (no periods or no in-scope items ⇒ an empty series).
 */
export function computeFlowMetrics(items: readonly FlowItem[], options: FlowMetricsOptions): FlowMetricsResult {
  const byPoints = options?.weightBy === "points";
  const periods = [...new Set((Array.isArray(options?.periods) ? options.periods : []).map((p) => optNum(p)).filter((p): p is number => p !== null))].sort((a, b) => a - b);

  const empty: FlowMetricsResult = {
    points: [],
    summary: { totalScope: 0, totalCompleted: 0, remaining: 0, throughputTotal: 0, meanThroughput: 0, percentComplete: null },
  };
  if (!periods.length) return empty;

  // Resolve the in-scope items once (drop non-objects, blank ids and cancelled items).
  const resolved: Resolved[] = [];
  if (Array.isArray(items)) {
    for (const raw of items) {
      if (raw === null || typeof raw !== "object") continue;
      const it = raw as FlowItem;
      if (coerceId(it.id) === null) continue;
      if (statusClassOf(typeof it.status === "string" ? it.status : "") === "cancelled") continue;
      resolved.push({
        createdAt: optNum(it.createdAt),
        startedAt: optNum(it.startedAt),
        completedAt: optNum(it.completedAt),
        measure: byPoints ? Math.max(0, numLoose(it.points)) : 1,
      });
    }
  }

  const points: FlowPoint[] = [];
  let openingScope = 0;
  for (let i = 0; i < periods.length; i++) {
    const t = periods[i]!;
    const prev = i > 0 ? periods[i - 1]! : null;
    let scope = 0, done = 0, active = 0, backlog = 0, throughput = 0;
    for (const r of resolved) {
      const inScope = r.createdAt === null || r.createdAt <= t;
      if (!inScope) continue;
      scope += r.measure;
      const isDone = r.completedAt !== null && r.completedAt <= t;
      if (isDone) {
        done += r.measure;
        // Throughput: completed within (prev, t] — or (−∞, t] for the first bucket.
        if (r.completedAt !== null && r.completedAt <= t && (prev === null || r.completedAt > prev)) throughput += r.measure;
      } else if (r.startedAt !== null && r.startedAt <= t) {
        active += r.measure;
      } else {
        backlog += r.measure;
      }
    }
    if (i === 0) openingScope = scope;
    // Ideal burn-down: linear from the opening scope at period[0] to 0 at the last period (guarded slope).
    const span = periods.length - 1;
    const ideal = span > 0 ? round2((openingScope * (span - i)) / span) : 0;
    points.push({
      period: t,
      scope: round2(scope),
      completed: round2(done),
      remaining: round2(scope - done),
      ideal,
      backlog: round2(backlog),
      active: round2(active),
      done: round2(done),
      throughput: round2(throughput),
    });
  }

  const last = points[points.length - 1]!;
  const throughputTotal = points.reduce((s, p) => s + p.throughput, 0);
  return {
    points,
    summary: {
      totalScope: last.scope,
      totalCompleted: last.completed,
      remaining: round2(last.scope - last.completed),
      throughputTotal: round2(throughputTotal),
      meanThroughput: round2(throughputTotal / periods.length),
      percentComplete: last.scope > 0 ? round1((last.completed / last.scope) * 100) : null,
    },
  };
}
