/**
 * SPRINT AGGREGATION ENGINE — the sprint-review numbers every agile tool shows: per iteration, how much was
 * COMMITTED vs COMPLETED, how much scope was ADDED mid-sprint (churn), what CARRIED OVER, and the resulting
 * per-sprint VELOCITY series (roadmap §5.5 sprints/iterations + §4.3 agile reporting). This is the sprint-
 * GROUPED counterpart to the two flow engines it sits between: `flow-metrics` reconstructs a time-series from
 * item timestamps over arbitrary periods, and `velocity` turns a throughput series into stats + forecast
 * anchors — this groups work items by their sprint id and EMITS the per-sprint completed-points series that
 * `velocity` consumes, so sprint-metrics → velocity → pi-forecast is one clean chain.
 *
 * REUSES the shipped `work-vocabulary` status axis (`statusClassOf` → done detection, the same lifecycle
 * classes the board keys off) and the `num` guarded helpers rather than re-deriving either; mirrors
 * `task-workload` / `capacity` (records → pure roll-up, local `byId` tiebreak). Pure, no I/O, DETERMINISTIC
 * (no `Date`, no `Math.random`; sprints in caller order when supplied, else id-sorted). Validation-first and
 * fail-closed: ids coerced, non-object items dropped, an item with no sprint id is skipped, points coerce to
 * 0, every divide guarded (completion + churn rates are null when nothing was committed) — it never throws.
 * Empty ⇒ empty.
 */
import { statusClassOf } from "./work-vocabulary";
import { numLoose, round2 } from "./num";

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** One work item assigned to a sprint (a plain vendor-neutral shape below the seam). */
export interface SprintItem {
  id: string;
  /** The sprint / iteration this item belongs to; blank/absent ⇒ the item is skipped (unsprinted). */
  sprintId?: string | null;
  /** Work-item status; a `done`-class status ⇒ completed. */
  status?: string | null;
  /** Story points / estimate; absent/dirty ⇒ counted as 0 points (still counts toward item counts). */
  points?: number | null;
  /** False ⇒ the item was NOT part of the original sprint commitment. Default true (committed). */
  committed?: boolean | null;
  /** True ⇒ the item was ADDED after the sprint started (scope churn). */
  added?: boolean | null;
}

export interface SprintMetricsOptions {
  /** Explicit sprint order (ids) for the output + velocity series; unlisted sprints follow, id-sorted. */
  sprintOrder?: string[];
}

export interface SprintRollup {
  sprintId: string;
  /** Items committed at sprint start (committed !== false and not added). */
  committedItems: number;
  committedPoints: number;
  /** Items added mid-sprint. */
  addedItems: number;
  addedPoints: number;
  /** Completed (done-class) items / points — the sprint's velocity. */
  completedItems: number;
  completedPoints: number;
  /** Every item in the sprint (committed + added). */
  totalItems: number;
  totalPoints: number;
  /** Committed work not completed (carried into the next sprint). */
  carryoverItems: number;
  carryoverPoints: number;
  /** completedPoints / committedPoints, 2dp; null when nothing was committed. */
  completionRate: number | null;
  /** addedPoints / committedPoints, 2dp; null when nothing was committed. */
  scopeChangeRate: number | null;
}

export interface SprintMetricsResult {
  /** Per sprint, in `sprintOrder` then id order. */
  sprints: SprintRollup[];
  /** Per-sprint completed points in the same order — feed straight into `computeVelocity({ throughput })`. */
  velocitySeries: number[];
  summary: {
    sprints: number;
    committedPoints: number;
    completedPoints: number;
    addedPoints: number;
    carryoverPoints: number;
    /** Mean completed points per sprint (0 when no sprints). */
    meanVelocity: number;
    /** completedPoints / committedPoints across all sprints, 2dp; null when nothing committed. */
    overallCompletionRate: number | null;
  };
}

/** Coerce a value to a stable string id (non-blank string, or a finite number), else null. */
function coerceId(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

interface Acc {
  committedItems: number; committedPoints: number;
  addedItems: number; addedPoints: number;
  completedItems: number; completedPoints: number;
  totalItems: number; totalPoints: number;
  carryoverItems: number; carryoverPoints: number;
}
const emptyAcc = (): Acc => ({ committedItems: 0, committedPoints: 0, addedItems: 0, addedPoints: 0, completedItems: 0, completedPoints: 0, totalItems: 0, totalPoints: 0, carryoverItems: 0, carryoverPoints: 0 });

/**
 * Aggregate work items into per-sprint commit-vs-complete metrics + a velocity series. Deterministic,
 * fail-closed, empty ⇒ empty (an item with no sprint id is skipped).
 */
export function computeSprintMetrics(items: readonly SprintItem[], options: SprintMetricsOptions = {}): SprintMetricsResult {
  const bySprint = new Map<string, Acc>();

  if (Array.isArray(items)) {
    for (const raw of items) {
      if (raw === null || typeof raw !== "object") continue;
      const it = raw as SprintItem;
      if (coerceId(it.id) === null) continue;
      const sprintId = coerceId(it.sprintId);
      if (sprintId === null) continue; // unsprinted items are not part of any sprint

      const points = Math.max(0, numLoose(it.points));
      const isDone = statusClassOf(typeof it.status === "string" ? it.status : "") === "done";
      const isAdded = it.added === true;
      const isCommitted = it.committed !== false && !isAdded;

      const a = bySprint.get(sprintId) ?? emptyAcc();
      a.totalItems++; a.totalPoints += points;
      if (isCommitted) { a.committedItems++; a.committedPoints += points; }
      if (isAdded) { a.addedItems++; a.addedPoints += points; }
      if (isDone) { a.completedItems++; a.completedPoints += points; }
      if (isCommitted && !isDone) { a.carryoverItems++; a.carryoverPoints += points; }
      bySprint.set(sprintId, a);
    }
  }

  // Order: caller's sprintOrder first (those that exist), then any remaining sprints id-sorted.
  const order = Array.isArray(options?.sprintOrder) ? options.sprintOrder.map(coerceId).filter((s): s is string => s !== null) : [];
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const s of order) if (bySprint.has(s) && !seen.has(s)) { ordered.push(s); seen.add(s); }
  for (const s of [...bySprint.keys()].sort(byId)) if (!seen.has(s)) { ordered.push(s); seen.add(s); }

  const sprints: SprintRollup[] = ordered.map((sprintId) => {
    const a = bySprint.get(sprintId)!;
    return {
      sprintId,
      committedItems: a.committedItems, committedPoints: round2(a.committedPoints),
      addedItems: a.addedItems, addedPoints: round2(a.addedPoints),
      completedItems: a.completedItems, completedPoints: round2(a.completedPoints),
      totalItems: a.totalItems, totalPoints: round2(a.totalPoints),
      carryoverItems: a.carryoverItems, carryoverPoints: round2(a.carryoverPoints),
      completionRate: a.committedPoints > 0 ? round2(a.completedPoints / a.committedPoints) : null,
      scopeChangeRate: a.committedPoints > 0 ? round2(a.addedPoints / a.committedPoints) : null,
    };
  });

  const velocitySeries = sprints.map((s) => s.completedPoints);
  const committedPoints = sprints.reduce((t, s) => t + s.committedPoints, 0);
  const completedPoints = sprints.reduce((t, s) => t + s.completedPoints, 0);
  const addedPoints = sprints.reduce((t, s) => t + s.addedPoints, 0);
  const carryoverPoints = sprints.reduce((t, s) => t + s.carryoverPoints, 0);

  return {
    sprints,
    velocitySeries,
    summary: {
      sprints: sprints.length,
      committedPoints: round2(committedPoints),
      completedPoints: round2(completedPoints),
      addedPoints: round2(addedPoints),
      carryoverPoints: round2(carryoverPoints),
      meanVelocity: sprints.length ? round2(completedPoints / sprints.length) : 0,
      overallCompletionRate: committedPoints > 0 ? round2(completedPoints / committedPoints) : null,
    },
  };
}
