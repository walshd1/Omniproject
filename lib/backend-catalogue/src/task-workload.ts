/**
 * TASK WORKLOAD / WIP / AGING ENGINE — a pure, STATELESS analyser for GTD next-action load (task-management
 * assessment gap T2). The task roll-up (`task-summary`) counts open tasks by assignee, but nothing said
 * "Ada is over her WIP limit" or "11 open tasks have sat untouched for 30+ days". This crosses the open
 * tasks against per-assignee WIP limits (who is overloaded, by how much) and buckets them by age (how long
 * open work has aged), so a lead sees the same over-WIP / aging signal a kanban tool surfaces.
 *
 * Mirrors `capacity.ts` — sorted output, guarded divides, plain in/out records below the seam — but over
 * GTD tasks rather than resource periods, and reuses `isTaskStatusClosed` (a done/dropped task is not open
 * work) and the `task-summary` "unassigned" bucketing. Pure, DETERMINISTIC: it never calls `Date`; `now`
 * and every timestamp are epoch-millisecond numbers passed in, so a run and its test are reproducible. The
 * ms→days divide is by a fixed constant (never NaN/±Infinity); ages clamp ≥ 0; validation-first and fail-
 * closed (ids coerced to strings, dirty/absent timestamps handled, malformed entries dropped, never throws);
 * empty ⇒ empty.
 */
import { isTaskStatusClosed } from "./task-vocabulary";
import { numLoose, optNum, round2 } from "./num";

const MS_PER_DAY = 86_400_000;
const byStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const UNASSIGNED = "unassigned";
const DEFAULT_AGING_BOUNDARIES = [1, 3, 7, 14, 30];

export interface WorkloadTask {
  id: string;
  /** Who owns it; blank/absent ⇒ the "unassigned" bucket. */
  assignee?: string | null;
  /** GTD status; a done/dropped status ⇒ not open work. */
  status?: string | null;
  /** When the task was created (epoch ms); used as the age baseline. Absent/dirty ⇒ excluded from aging. */
  createdAt?: number | null;
}

export interface TaskWorkloadOptions {
  /** Current time as epoch ms — REQUIRED (the engine never calls Date). */
  now: number;
  /** Per-assignee WIP limit (max open tasks before "over-WIP"). */
  wipLimitByAssignee?: Record<string, number>;
  /** Fallback WIP limit for an assignee with no explicit entry. Omitted ⇒ no limit (never over-WIP). */
  defaultWipLimit?: number;
  /** Ascending day boundaries for the aging buckets. Default [1, 3, 7, 14, 30] ⇒ 0-1d … 30d+. */
  agingBucketsDays?: number[];
}

export interface AssigneeLoad {
  assignee: string;
  /** Open (not done/dropped) tasks assigned to them. */
  openCount: number;
  /** The applied WIP limit, or null when none applies. */
  wipLimit: number | null;
  /** True when openCount exceeds the limit. */
  overWip: boolean;
  /** How far over the limit (0 when under/at limit or no limit). */
  overBy: number;
}

export interface AgingBucket {
  label: string;
  /** Inclusive lower age bound in days. */
  fromDays: number;
  /** Exclusive upper age bound in days, or null for the open-ended final bucket. */
  toDays: number | null;
  count: number;
}

export interface TaskWorkloadResult {
  /** Per-assignee open-task load ("unassigned" collects blank-assignee tasks), assignee-id sorted. */
  byAssignee: AssigneeLoad[];
  /** The assignees over their WIP limit, worst (most-over) first, assignee-id tiebroken. */
  overWip: AssigneeLoad[];
  /** Open tasks bucketed by age-since-created (only tasks with a known createdAt), in bucket order. */
  aging: AgingBucket[];
  counts: {
    openTotal: number;
    closedTotal: number;
    unassignedOpen: number;
    assigneesOverWip: number;
    /** Open tasks with no usable createdAt (excluded from the aging buckets). */
    agingUnknown: number;
  };
  /** The greatest age (days) among open tasks with a known createdAt; 0 when none. */
  oldestOpenAgeDays: number;
}

/** Build the empty aging buckets from ascending day boundaries: [0,b1) … [bn,∞). */
function buildBuckets(boundaries: readonly number[]): AgingBucket[] {
  const cleaned = [...new Set(boundaries.map((b) => Math.max(0, numLoose(b))).filter((b) => b > 0))].sort((a, b) => a - b);
  const buckets: AgingBucket[] = [];
  let from = 0;
  for (const to of cleaned) {
    buckets.push({ label: `${from}-${to}d`, fromDays: from, toDays: to, count: 0 });
    from = to;
  }
  buckets.push({ label: `${from}d+`, fromDays: from, toDays: null, count: 0 });
  return buckets;
}

/**
 * Analyse the open tasks: per-assignee WIP load + age buckets. `now` and all timestamps are epoch-ms numbers
 * supplied by the caller. Closed (done/dropped) tasks are excluded from every count; empty ⇒ empty.
 */
export function analyzeTaskWorkload(tasks: readonly WorkloadTask[], options: TaskWorkloadOptions): TaskWorkloadResult {
  const now = numLoose(options.now);
  const limits = options.wipLimitByAssignee ?? {};
  const defaultLimit = options.defaultWipLimit === undefined ? null : Math.max(0, numLoose(options.defaultWipLimit));

  const openByAssignee = new Map<string, number>();
  const buckets = buildBuckets(options.agingBucketsDays ?? DEFAULT_AGING_BOUNDARIES);
  let openTotal = 0;
  let closedTotal = 0;
  let agingUnknown = 0;
  let oldestOpenAgeDays = 0;

  if (Array.isArray(tasks)) {
    for (const t of tasks) {
      if (t === null || typeof t !== "object") continue;
      if (isTaskStatusClosed((t as WorkloadTask).status)) {
        closedTotal++;
        continue;
      }
      openTotal++;
      const who = typeof (t as WorkloadTask).assignee === "string" && (t as WorkloadTask).assignee!.trim() ? (t as WorkloadTask).assignee!.trim() : UNASSIGNED;
      openByAssignee.set(who, (openByAssignee.get(who) ?? 0) + 1);

      const createdAt = optNum((t as WorkloadTask).createdAt);
      if (createdAt === null) {
        agingUnknown++;
        continue;
      }
      const ageDays = Math.max(0, (now - createdAt) / MS_PER_DAY); // divide by a constant — never NaN/Infinity
      if (ageDays > oldestOpenAgeDays) oldestOpenAgeDays = ageDays;
      const bucket = buckets.find((b) => b.toDays === null || ageDays < b.toDays)!; // last bucket is open-ended
      bucket.count++;
    }
  }

  const byAssignee: AssigneeLoad[] = [...openByAssignee.entries()]
    .map(([assignee, openCount]) => {
      const explicit = Object.prototype.hasOwnProperty.call(limits, assignee) ? Math.max(0, numLoose(limits[assignee])) : null;
      const wipLimit = explicit !== null ? explicit : assignee === UNASSIGNED ? null : defaultLimit;
      const overBy = wipLimit !== null ? Math.max(0, openCount - wipLimit) : 0;
      return { assignee, openCount, wipLimit, overWip: overBy > 0, overBy };
    })
    .sort((a, b) => byStr(a.assignee, b.assignee));

  const overWip = byAssignee
    .filter((a) => a.overWip)
    .sort((a, b) => (b.overBy !== a.overBy ? b.overBy - a.overBy : byStr(a.assignee, b.assignee)));

  return {
    byAssignee,
    overWip,
    aging: buckets,
    counts: {
      openTotal,
      closedTotal,
      unassignedOpen: openByAssignee.get(UNASSIGNED) ?? 0,
      assigneesOverWip: overWip.length,
      agingUnknown,
    },
    oldestOpenAgeDays: round2(oldestOpenAgeDays),
  };
}
