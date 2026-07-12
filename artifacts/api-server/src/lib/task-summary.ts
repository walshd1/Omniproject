import type { Task } from "../broker/types";
import { normaliseTaskStatus, TASK_STATUS_CLASS, isTaskClosed, isActionable, type TaskStatusClass } from "../broker/vocabulary";

/**
 * Task roll-up — the report/rollup INPUT for tasks (GTD next-actions), the analogue of the issue/project
 * roll-ups. Pure + deterministic so it's unit-tested and any report can consume it: the GTD breakdown,
 * how much is actionable now, what's overdue, and who/what/where the work sits (assignee · tag · context).
 */
export interface TaskSummary {
  total: number;
  /** Counts by GTD workflow class (actionable / waiting / deferred / done / dropped). */
  byClass: Record<TaskStatusClass, number>;
  /** Not done and not dropped. */
  open: number;
  /** Available next-actions (the "what can I do now" number). */
  actionable: number;
  /** Open tasks whose due date is in the past. */
  overdue: number;
  /** Open tasks due within the next 7 days. */
  dueSoon: number;
  /** Open tasks with no assignee. */
  unassigned: number;
  /** Open-task counts by assignee. */
  byAssignee: Record<string, number>;
  /** Open-task counts by tag. */
  byTag: Record<string, number>;
  /** Open-task counts by GTD context. */
  byContext: Record<string, number>;
}

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

/** Summarise a set of tasks for reporting. `now` defaults to the current time (overridable for tests). */
export function summariseTasks(tasks: Task[], now: Date = new Date()): TaskSummary {
  const byClass: Record<TaskStatusClass, number> = { actionable: 0, waiting: 0, deferred: 0, done: 0, dropped: 0 };
  const byAssignee: Record<string, number> = {};
  const byTag: Record<string, number> = {};
  const byContext: Record<string, number> = {};
  let open = 0, actionable = 0, overdue = 0, dueSoon = 0, unassigned = 0;
  const nowMs = now.getTime();

  for (const t of tasks) {
    const canon = normaliseTaskStatus(t.status);
    byClass[canon ? TASK_STATUS_CLASS[canon] : "actionable"]++; // unknown/absent ⇒ actionable (default-safe)
    const closed = isTaskClosed(t.status);
    if (isActionable(t.status)) actionable++;
    if (closed) continue;

    open++;
    if (t.dueDate) {
      const due = Date.parse(t.dueDate);
      if (Number.isFinite(due)) {
        if (due < nowMs) overdue++;
        else if (due - nowMs <= SEVEN_DAYS) dueSoon++;
      }
    }
    const who = typeof t.assignee === "string" && t.assignee.trim() ? t.assignee.trim() : "";
    if (who) bump(byAssignee, who); else unassigned++;
    for (const tag of t.tags ?? []) if (tag) bump(byTag, tag);
    const ctx = typeof t.context === "string" && t.context.trim() ? t.context.trim() : "";
    if (ctx) bump(byContext, ctx);
  }

  return { total: tasks.length, byClass, open, actionable, overdue, dueSoon, unassigned, byAssignee, byTag, byContext };
}
