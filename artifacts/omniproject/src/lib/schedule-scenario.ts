/**
 * Schedule what-if engine — a STATELESS, in-browser scheduler for "if this work
 * package starts later, what are the knock-ons?".
 *
 * It forks the dates we already read live (issue start/due) into local copies,
 * applies user-drawn shifts (drag a bar into the future), and propagates the
 * effect down a dependency graph: a successor cannot start before its
 * predecessors finish. The result is a *projection* — never written back, never
 * persisted server-side. Like scenario.ts it is pure so the maths is fully
 * unit-testable and obviously not a source of truth.
 *
 * This is deliberately NOT a planner of record: no new backend fields, no broker
 * call, no storage. Dependencies are the ones you already asserted (or draw in
 * the sandbox), and every figure it emits is `projected`.
 */

const DAY_MS = 1000 * 60 * 60 * 24;

/** Whole-day index (UTC-agnostic floor), matching the Gantt view's bucketing. */
export function startOfDay(d: Date): number {
  return Math.floor(d.getTime() / DAY_MS);
}

/** The minimal issue shape the engine needs (a subset of the live Issue). */
export interface ScheduleInput {
  id: string;
  title: string;
  status: string;
  startDate?: string | null;
  dueDate?: string | null;
}

/** A directed precedence edge: `successor` cannot start before `predecessor` ends. */
export interface DepEdge {
  predecessorId: string;
  successorId: string;
}

/** Base (unshifted) schedule for one issue that has at least one date. */
export interface ScheduleItem {
  id: string;
  title: string;
  status: string;
  baseStartDay: number;
  baseEndDay: number;
  durationDays: number;
  /** The original due date = the deadline, for breach detection (null if none). */
  baseDueDay: number | null;
}

/** Resolved (post-cascade) schedule for one issue. */
export interface ResolvedItem extends ScheduleItem {
  resolvedStartDay: number;
  resolvedEndDay: number;
  /** Days the user explicitly dragged this bar. */
  userShiftDays: number;
  /** Extra days pushed by predecessors beyond where the user put it. */
  cascadeShiftDays: number;
  /** resolvedStart − baseStart. */
  totalShiftDays: number;
  movedByUser: boolean;
  movedByCascade: boolean;
  /** Finishes after its original deadline. */
  breached: boolean;
  /** Breached now, but wasn't already past its deadline in the base plan. */
  newlyBreached: boolean;
}

export interface ScheduleSummary {
  directlyMovedCount: number;
  knockOnCount: number;
  affectedCount: number;
  projectEndDeltaDays: number;
  newBreachCount: number;
  /** A dependency cycle was detected; the cyclic edges were ignored. */
  hasCycle: boolean;
}

export interface ScheduleResult {
  items: ResolvedItem[];
  summary: ScheduleSummary;
  /** Inclusive day range spanning both base and resolved bars, for rendering. */
  rangeStartDay: number;
  rangeEndDay: number;
}

/**
 * Build the base schedule from live issues. Issues with no date at all are
 * dropped (nothing to place on a timeline). A single date yields a zero-duration
 * milestone; two dates yield a bar (end clamped to ≥ start).
 */
export function buildScheduleItems(inputs: ScheduleInput[]): ScheduleItem[] {
  const items: ScheduleItem[] = [];
  for (const i of inputs) {
    if (!i.startDate && !i.dueDate) continue;
    const start = i.startDate ? new Date(i.startDate) : new Date(i.dueDate!);
    const end = i.dueDate ? new Date(i.dueDate) : new Date(i.startDate!);
    let s = startOfDay(start);
    let e = startOfDay(end);
    if (e < s) [s, e] = [e, s];
    items.push({
      id: i.id,
      title: i.title,
      status: i.status,
      baseStartDay: s,
      baseEndDay: e,
      durationDays: e - s,
      baseDueDay: i.dueDate ? startOfDay(new Date(i.dueDate)) : null,
    });
  }
  return items;
}

/**
 * Resolve the schedule under `shifts` (issueId → days the user dragged its start)
 * and `edges` (precedence). Forward pass in topological order; a successor's
 * start is pushed to the latest predecessor finish if that's later than where the
 * user put it. Cyclic edges are ignored (and flagged) rather than hanging.
 */
export function computeSchedule(
  items: ScheduleItem[],
  edges: DepEdge[],
  shifts: Record<string, number>,
): ScheduleResult {
  const byId = new Map(items.map((it) => [it.id, it]));

  // Keep only edges whose endpoints both exist and aren't self-loops.
  const valid = edges.filter(
    (e) => e.predecessorId !== e.successorId && byId.has(e.predecessorId) && byId.has(e.successorId),
  );

  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const it of items) {
    preds.set(it.id, []);
    succs.set(it.id, []);
    indegree.set(it.id, 0);
  }
  for (const e of valid) {
    preds.get(e.successorId)!.push(e.predecessorId);
    succs.get(e.predecessorId)!.push(e.successorId);
    indegree.set(e.successorId, (indegree.get(e.successorId) ?? 0) + 1);
  }

  // Kahn topological order.
  const queue: string[] = [];
  for (const it of items) if ((indegree.get(it.id) ?? 0) === 0) queue.push(it.id);
  const order: string[] = [];
  const localIndeg = new Map(indegree);
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const s of succs.get(id) ?? []) {
      localIndeg.set(s, (localIndeg.get(s) ?? 0) - 1);
      if ((localIndeg.get(s) ?? 0) === 0) queue.push(s);
    }
  }
  const hasCycle = order.length < items.length;
  // Append any cycle-trapped nodes so they still get a (constraint-free) result.
  if (hasCycle) for (const it of items) if (!order.includes(it.id)) order.push(it.id);

  const resolvedStart = new Map<string, number>();
  const resolvedEnd = new Map<string, number>();
  for (const id of order) {
    const it = byId.get(id)!;
    const desired = it.baseStartDay + (shifts[id] ?? 0);
    let start = desired;
    for (const p of preds.get(id) ?? []) {
      const pe = resolvedEnd.get(p);
      if (pe != null && pe > start) start = pe;
    }
    resolvedStart.set(id, start);
    resolvedEnd.set(id, start + it.durationDays);
  }

  const resolved: ResolvedItem[] = items.map((it) => {
    const rs = resolvedStart.get(it.id)!;
    const re = resolvedEnd.get(it.id)!;
    const userShift = shifts[it.id] ?? 0;
    const desired = it.baseStartDay + userShift;
    const cascade = rs - desired;
    const total = rs - it.baseStartDay;
    const breached = it.baseDueDay != null && re > it.baseDueDay;
    const wasBreached = it.baseDueDay != null && it.baseEndDay > it.baseDueDay;
    return {
      ...it,
      resolvedStartDay: rs,
      resolvedEndDay: re,
      userShiftDays: userShift,
      cascadeShiftDays: cascade,
      totalShiftDays: total,
      movedByUser: userShift !== 0,
      movedByCascade: cascade > 0,
      breached,
      newlyBreached: breached && !wasBreached,
    };
  });

  const baseEnd = items.length ? Math.max(...items.map((it) => it.baseEndDay)) : 0;
  const resEnd = resolved.length ? Math.max(...resolved.map((it) => it.resolvedEndDay)) : 0;

  const summary: ScheduleSummary = {
    directlyMovedCount: resolved.filter((it) => it.movedByUser).length,
    knockOnCount: resolved.filter((it) => it.movedByCascade && !it.movedByUser).length,
    affectedCount: resolved.filter((it) => it.totalShiftDays !== 0).length,
    projectEndDeltaDays: resEnd - baseEnd,
    newBreachCount: resolved.filter((it) => it.newlyBreached).length,
    hasCycle,
  };

  const starts = resolved.flatMap((it) => [it.baseStartDay, it.resolvedStartDay]);
  const ends = resolved.flatMap((it) => [it.baseEndDay, it.resolvedEndDay]);
  return {
    items: resolved,
    summary,
    rangeStartDay: starts.length ? Math.min(...starts) : 0,
    rangeEndDay: ends.length ? Math.max(...ends) : 0,
  };
}
