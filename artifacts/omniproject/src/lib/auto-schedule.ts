import { type WorkingCalendar, nextWorkingDay, workingFinish } from "./working-calendar";
import {
  type TypedDependency,
  type TaskConstraint,
  type Placement,
  earliestStartFromDependency,
  applyConstraint,
  constraintViolation,
} from "./schedule-constraints";

/**
 * Forward-pass AUTO-SCHEDULER (roadmap 3.1 slice 3) — the engine that walks a dependency graph in
 * topological order and places every task at its earliest working-day start, composing the slice-1 working
 * calendar and the slice-2 typed-dependency + constraint primitives. This is the multi-task generalisation
 * of `schedule-scenario.computeSchedule`: it adds working calendars, FS/SS/FF/SF + lead/lag, and date
 * constraints (SNET/FNLT/…).
 *
 * Like the rest of the scheduling stack it is PURE and PROJECTED: inputs → a placement per task, no
 * persistence, no server call, never a source of truth. Cyclic edges are ignored (and flagged) rather than
 * hanging; the trapped nodes still get a floor+constraint placement.
 */

/** A schedulable activity. `earliestStartDay` is its ASAP floor when nothing else drives it. */
export interface ScheduleTask {
  id: string;
  durationWorkingDays: number;
  constraint?: TaskConstraint;
  /** The task's own earliest start (e.g. its current start date); defaults to the project start. */
  earliestStartDay?: number;
}

export interface AutoScheduleInput {
  tasks: readonly ScheduleTask[];
  dependencies: readonly TypedDependency[];
  /** The floor for tasks with no predecessor / earlier anchor. */
  projectStartDay: number;
}

/** A placed task. `driverId` is the predecessor that determined the start (null = floor/constraint). */
export interface ScheduledTask extends Placement {
  id: string;
  durationWorkingDays: number;
  violatesConstraint: boolean;
  driverId: string | null;
}

export interface AutoScheduleResult {
  tasks: Record<string, ScheduledTask>;
  /** Topological order actually used (cycle-trapped nodes appended). */
  order: string[];
  projectStartDay: number;
  projectFinishDay: number;
  hasCycle: boolean;
  /** Ids of tasks whose constraint is breached in the resolved plan. */
  violations: string[];
}

/**
 * Auto-schedule the tasks. Forward pass in topological order: each task's start is the latest of its floor
 * and every incoming dependency's implied start, then its constraint is applied; its finish follows from the
 * working-day duration on the calendar. Deterministic and pure.
 */
export function autoSchedule(cal: WorkingCalendar, input: AutoScheduleInput): AutoScheduleResult {
  const { tasks, dependencies, projectStartDay } = input;
  const byId = new Map(tasks.map((t) => [t.id, t]));

  // Keep only edges whose endpoints both exist and aren't self-loops.
  const valid = dependencies.filter(
    (e) => e.predecessorId !== e.successorId && byId.has(e.predecessorId) && byId.has(e.successorId),
  );

  const incoming = new Map<string, TypedDependency[]>();
  const succs = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const t of tasks) {
    incoming.set(t.id, []);
    succs.set(t.id, []);
    indegree.set(t.id, 0);
  }
  for (const e of valid) {
    incoming.get(e.successorId)!.push(e);
    succs.get(e.predecessorId)!.push(e.successorId);
    indegree.set(e.successorId, (indegree.get(e.successorId) ?? 0) + 1);
  }

  // Kahn topological order.
  const queue: string[] = [];
  for (const t of tasks) if ((indegree.get(t.id) ?? 0) === 0) queue.push(t.id);
  const order: string[] = [];
  const inOrder = new Set<string>();
  const localIndeg = new Map(indegree);
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++]!;
    order.push(id);
    inOrder.add(id);
    for (const s of succs.get(id) ?? []) {
      localIndeg.set(s, (localIndeg.get(s) ?? 0) - 1);
      if ((localIndeg.get(s) ?? 0) === 0) queue.push(s);
    }
  }
  const hasCycle = order.length < tasks.length;
  if (hasCycle) for (const t of tasks) if (!inOrder.has(t.id)) { order.push(t.id); inOrder.add(t.id); }

  const placed = new Map<string, ScheduledTask>();
  for (const id of order) {
    const task = byId.get(id)!;
    const floor = nextWorkingDay(cal, task.earliestStartDay ?? projectStartDay);
    let start = floor;
    let driverId: string | null = null;
    for (const dep of incoming.get(id) ?? []) {
      const pred = placed.get(dep.predecessorId);
      if (!pred) continue; // a cyclic predecessor not yet placed — skip its (ignored) constraint
      const implied = earliestStartFromDependency(cal, dep, pred, task.durationWorkingDays);
      if (implied > start) { start = implied; driverId = dep.predecessorId; }
    }
    const constrained = applyConstraint(cal, task.constraint, start, task.durationWorkingDays);
    if (constrained !== start) driverId = null; // the constraint, not a predecessor, set the final start
    const startDay = nextWorkingDay(cal, constrained);
    const finishDay = workingFinish(cal, startDay, task.durationWorkingDays);
    const placement: Placement = { startDay, finishDay };
    placed.set(id, {
      id,
      durationWorkingDays: task.durationWorkingDays,
      startDay,
      finishDay,
      violatesConstraint: constraintViolation(task.constraint, placement),
      driverId,
    });
  }

  let projectStart = Infinity;
  let projectFinish = -Infinity;
  const violations: string[] = [];
  const out: Record<string, ScheduledTask> = {};
  for (const id of order) {
    const p = placed.get(id)!;
    out[id] = p;
    projectStart = Math.min(projectStart, p.startDay);
    projectFinish = Math.max(projectFinish, p.finishDay);
    if (p.violatesConstraint) violations.push(id);
  }

  return {
    tasks: out,
    order,
    projectStartDay: tasks.length ? projectStart : projectStartDay,
    projectFinishDay: tasks.length ? projectFinish : projectStartDay,
    hasCycle,
    violations,
  };
}
