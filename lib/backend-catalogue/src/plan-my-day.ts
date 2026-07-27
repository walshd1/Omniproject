/**
 * PLAN-MY-DAY SELECTOR — a pure, STATELESS "what should I actually do today" chooser for GTD next-actions
 * (task-management assessment gap T6). The workload engine (`task-workload`) says who is over WIP and how
 * open work has aged, but nothing turned the open list into a ranked, capped TODAY commitment — the daily
 * review a GTD tool does when it surfaces "these are the N things worth committing to now". This picks the
 * OPEN tasks that are overdue, due-today, or flagged / high-priority, ranks them WORST-FIRST (most-overdue,
 * then due-today, then priority, then id), and caps the list by a daily item count and/or a running
 * estimate-hours (and optional energy) budget — skipping a task that would blow the remaining budget but
 * continuing to scan so a smaller task later can still fit.
 *
 * Mirrors `task-workload` — sorted output, guarded divides, plain in/out records below the seam — and
 * REUSES the shared vocabularies rather than re-deriving them: `isTaskStatusClosed` (a done/dropped task is
 * never "today's work"), the `PRIORITY_RANK` ordinal ladder from `work-vocabulary` (the same none < low <
 * medium < high < urgent invariant the sorting/RICE/WSJF maths key off — a caller may override it), and the
 * `ENERGY_LEVEL` ordinal from `energy-vocabulary` for the energy-budget fit. Pure, DETERMINISTIC: it never
 * calls `Date`; `now` and every timestamp are epoch-millisecond numbers passed in, and the day boundary is
 * derived from `now` by flooring to a whole UTC day (a fixed-constant divide, never NaN/±Infinity), so a run
 * and its test are reproducible and the id tiebreak makes the order total. Validation-first and fail-closed:
 * ids are coerced to strings, non-object entries dropped, dirty/absent timestamps + estimates handled, every
 * divide guarded — it never throws. Empty ⇒ empty.
 */
import { isTaskStatusClosed } from "./task-vocabulary";
import { PRIORITY_RANK } from "./work-vocabulary";
import { ENERGY_LEVEL, type CanonicalEnergy } from "./energy-vocabulary";
import { numLoose, optNum, round2 } from "./num";

const MS_PER_DAY = 86_400_000;
const byStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A candidate next-action. Only `id` is required; every other field is read defensively. */
export interface PlanTask {
  id: string;
  /** GTD status; a done/dropped status ⇒ never today's work. */
  status?: string | null;
  /** When it is due (epoch ms). Absent/dirty ⇒ no due signal (can still be picked when flagged/high). */
  dueDate?: number | null;
  /** Priority token (ranked via `priorityRank`, default the shared none…urgent ladder). */
  priority?: string | null;
  /** Energy/effort token (low|medium|high) — costed against `energyBudget` when one is set. */
  energy?: string | null;
  /** Estimated hours of effort — summed against `capacityHours`. Absent/dirty ⇒ costs 0. */
  estimateHours?: number | null;
  /** Explicitly flagged/starred for attention ⇒ eligible regardless of due date. */
  flagged?: boolean | null;
  /** Alias for {@link flagged} — either truthy flag makes a task eligible. */
  starred?: boolean | null;
}

export interface PlanMyDayOptions {
  /** Current time as epoch ms — REQUIRED (the engine never calls Date). The "today" window is the whole
   *  UTC day containing `now`. */
  now: number;
  /** Cap on how many tasks make the plan (0/absent ⇒ no item cap). */
  maxItems?: number;
  /** Cap on the running sum of picked tasks' estimate hours (0/absent ⇒ no hours cap). */
  capacityHours?: number;
  /** Cap on the running sum of picked tasks' energy ordinals (0/absent ⇒ no energy cap). */
  energyBudget?: number;
  /** Priority token → ordinal rank (higher = more urgent). Default the shared `PRIORITY_RANK` ladder. */
  priorityRank?: Record<string, number>;
}

/** Why a task falls in the plan — its selection tier, worst-first. */
export type PlanReasonKind = "overdue" | "due_today" | "high_priority" | "flagged";

export interface PlannedTask {
  id: string;
  /** Human-readable reason ("overdue 3d" / "due today" / "high priority" / "flagged"). */
  reason: string;
  /** The structured selection tier behind {@link reason}. */
  kind: PlanReasonKind;
  /** Whole days overdue (0 unless overdue). */
  overdueDays: number;
  /** True when the task is due within today's window. */
  dueToday: boolean;
  /** The resolved priority rank used for ordering. */
  priorityRank: number;
  /** The estimate hours costed against capacity (0 when absent/dirty). */
  estimateHours: number;
}

export interface ExcludedTask {
  id: string;
  /** Why it is not in today's plan ("closed" / "not due or flagged" / "over daily limit" /
   *  "over capacity" / "over energy budget"). */
  reason: string;
}

export interface PlanMyDayResult {
  /** Today's ranked commitment list, worst-first. */
  plan: PlannedTask[];
  /** Every other task (id-sorted) with why it is not in the plan. */
  excluded: ExcludedTask[];
  summary: {
    picked: number;
    overdue: number;
    dueToday: number;
    highPriority: number;
    flagged: number;
    /** Sum of the picked tasks' estimate hours (guarded, 2dp). */
    totalEstimateHours: number;
  };
}

/** One task resolved into the fields the selection + ranking key off. */
interface Candidate {
  id: string;
  overdueDays: number;
  dueToday: boolean;
  isFlagged: boolean;
  isHigh: boolean;
  priorityRank: number;
  estimateHours: number;
  energyCost: number;
}

/** Coerce a value to a stable string id (numbers/finite non-blank), else null. */
function coerceId(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * Rank today's open tasks and cap them by item / hours / energy budgets. `now` and all timestamps are
 * epoch-ms numbers supplied by the caller; the "today" window is the UTC day containing `now`. Closed
 * (done/dropped) tasks never enter the plan. Deterministic (id-tiebroken), fail-closed, empty ⇒ empty.
 */
export function planMyDay(tasks: readonly PlanTask[], options: PlanMyDayOptions): PlanMyDayResult {
  const now = numLoose(options?.now);
  const startOfToday = Math.floor(now / MS_PER_DAY) * MS_PER_DAY; // UTC day floor — a fixed-constant divide
  const endOfToday = startOfToday + MS_PER_DAY;

  const rankMap = options?.priorityRank && typeof options.priorityRank === "object" ? options.priorityRank : (PRIORITY_RANK as Record<string, number>);
  const highThreshold = "high" in rankMap ? numLoose(rankMap["high"]) : (PRIORITY_RANK.high as number);
  const rankOf = (priority: string | null | undefined): number => (priority && Object.prototype.hasOwnProperty.call(rankMap, priority) ? numLoose(rankMap[priority]) : 0);

  const maxItems = Math.max(0, Math.floor(optNum(options?.maxItems) ?? 0));
  const capacityHours = optNum(options?.capacityHours);
  const energyBudget = optNum(options?.energyBudget);

  const candidates: Candidate[] = [];
  const excluded: ExcludedTask[] = [];

  if (Array.isArray(tasks)) {
    for (const raw of tasks) {
      if (raw === null || typeof raw !== "object") continue;
      const t = raw as PlanTask;
      const id = coerceId(t.id);
      if (id === null) continue;

      if (isTaskStatusClosed(t.status)) {
        excluded.push({ id, reason: "closed" });
        continue;
      }

      const due = optNum(t.dueDate);
      let overdueDays = 0;
      let dueToday = false;
      if (due !== null) {
        const dueDayStart = Math.floor(due / MS_PER_DAY) * MS_PER_DAY;
        if (due < startOfToday) overdueDays = Math.max(0, (startOfToday - dueDayStart) / MS_PER_DAY);
        else if (due < endOfToday) dueToday = true;
      }
      const priorityRank = rankOf(t.priority);
      const isFlagged = t.flagged === true || t.starred === true;
      const isHigh = highThreshold > 0 && priorityRank >= highThreshold;

      if (overdueDays === 0 && !dueToday && !isFlagged && !isHigh) {
        excluded.push({ id, reason: "not due or flagged" });
        continue;
      }

      candidates.push({
        id,
        overdueDays,
        dueToday,
        isFlagged,
        isHigh,
        priorityRank,
        estimateHours: Math.max(0, numLoose(t.estimateHours)),
        energyCost: Math.max(0, numLoose(ENERGY_LEVEL[(typeof t.energy === "string" ? t.energy : "") as CanonicalEnergy])),
      });
    }
  }

  // Worst-first: overdue tier before due-today before priority/flag-only; within a tier the most-overdue,
  // then the higher priority rank, then the id — a total, deterministic order.
  const tierOf = (c: Candidate): number => (c.overdueDays > 0 ? 0 : c.dueToday ? 1 : 2);
  candidates.sort((a, b) => {
    const ta = tierOf(a);
    const tb = tierOf(b);
    if (ta !== tb) return ta - tb;
    if (a.overdueDays !== b.overdueDays) return b.overdueDays - a.overdueDays;
    if (a.priorityRank !== b.priorityRank) return b.priorityRank - a.priorityRank;
    return byStr(a.id, b.id);
  });

  const plan: PlannedTask[] = [];
  let usedHours = 0;
  let usedEnergy = 0;
  let overdue = 0;
  let dueTodayCount = 0;
  let highPriority = 0;
  let flagged = 0;

  for (const c of candidates) {
    if (maxItems > 0 && plan.length >= maxItems) {
      excluded.push({ id: c.id, reason: "over daily limit" });
      continue;
    }
    if (capacityHours !== null && usedHours + c.estimateHours > capacityHours) {
      excluded.push({ id: c.id, reason: "over capacity" }); // keep scanning — a smaller task later may fit
      continue;
    }
    if (energyBudget !== null && usedEnergy + c.energyCost > energyBudget) {
      excluded.push({ id: c.id, reason: "over energy budget" });
      continue;
    }

    const kind: PlanReasonKind = c.overdueDays > 0 ? "overdue" : c.dueToday ? "due_today" : c.isHigh ? "high_priority" : "flagged";
    const reason = kind === "overdue" ? `overdue ${c.overdueDays}d` : kind === "due_today" ? "due today" : kind === "high_priority" ? "high priority" : "flagged";
    plan.push({ id: c.id, reason, kind, overdueDays: c.overdueDays, dueToday: c.dueToday, priorityRank: c.priorityRank, estimateHours: c.estimateHours });

    usedHours += c.estimateHours;
    usedEnergy += c.energyCost;
    if (kind === "overdue") overdue++;
    else if (kind === "due_today") dueTodayCount++;
    else if (kind === "high_priority") highPriority++;
    else flagged++;
  }

  excluded.sort((a, b) => byStr(a.id, b.id));

  return {
    plan,
    excluded,
    summary: {
      picked: plan.length,
      overdue,
      dueToday: dueTodayCount,
      highPriority,
      flagged,
      totalEstimateHours: round2(usedHours),
    },
  };
}
