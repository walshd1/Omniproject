import type { Task } from "../broker/types";
import { isTaskClosed, normaliseTaskStatus } from "../broker/vocabulary";
import type { IcsEvent } from "./ical";

/**
 * Build the calendar events for a user's dated work — the pure core of the `.ics` feed. A VEVENT is
 * emitted per OPEN task that carries a due date (all-day on that date); done/dropped tasks and undated
 * tasks are skipped (nothing to put on a calendar). Optionally scoped to one person's assignments so
 * "your due dates" really means yours. Pure + deterministic so it's unit-tested.
 */

const norm = (s: string | null | undefined): string => (typeof s === "string" ? s.trim().toLowerCase() : "");

/** True when the task is assigned to any of the caller's identifiers (email/name/sub), case-insensitive. */
function assignedTo(task: Task, whoami: readonly string[]): boolean {
  const a = norm(task.assignee);
  if (!a) return false;
  return whoami.some((w) => w && norm(w) === a);
}

export interface TaskFeedOptions {
  /** When set, keep only tasks assigned to one of these identifiers (the caller's email/name/sub). */
  mineFor?: readonly string[];
}

/** One-line human description from the task's GTD metadata. */
function describe(task: Task): string {
  const bits: string[] = [];
  const canon = normaliseTaskStatus(task.status) ?? task.status;
  if (canon) bits.push(`Status: ${canon}`);
  if (task.context) bits.push(`Context: ${task.context}`);
  if (task.waitingOn) bits.push(`Waiting on: ${task.waitingOn}`);
  if (task.priority && task.priority !== "none") bits.push(`Priority: ${task.priority}`);
  return bits.join(" · ");
}

/** Map a task set to all-day due-date events, filtering out closed/undated (and non-mine) tasks. */
export function tasksToIcsEvents(tasks: Task[], opts: TaskFeedOptions = {}): IcsEvent[] {
  const events: IcsEvent[] = [];
  for (const t of tasks) {
    if (!t.dueDate) continue; // only dated work lands on a calendar
    if (isTaskClosed(t.status)) continue; // no point calendaring done/dropped work
    if (opts.mineFor && !assignedTo(t, opts.mineFor)) continue;
    const desc = describe(t);
    events.push({
      uid: `task-${t.id}@omniproject`,
      summary: t.title || "(untitled task)",
      start: t.dueDate,
      allDay: true,
      description: desc || undefined,
      url: t.url ?? undefined,
    });
  }
  return events;
}
