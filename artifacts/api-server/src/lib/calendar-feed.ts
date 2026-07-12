import type { Task, Row } from "../broker/types";
import { isTaskClosed, isClosed, normaliseTaskStatus } from "../broker/vocabulary";
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

/** Map a task set to all-day due-date events (with a reminder VALARM when the task carries
 *  `reminderAt`), filtering out closed/undated (and non-mine) tasks. */
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
      alarm: t.reminderAt ? { at: t.reminderAt, description: t.title || undefined } : undefined,
    });
  }
  return events;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** True when an issue row looks like a milestone (a distinct calendar marker vs an ordinary deadline). */
function isMilestone(row: Row): boolean {
  return str(row["type"]).toLowerCase() === "milestone" || !!str(row["milestone"]);
}

/** Map issue/deliverable rows to all-day DEADLINE events (milestones flagged), for the same feed.
 *  Issues carry `dueDate` as a canonical field; closed/undated (and non-mine) rows are skipped. */
export function issuesToIcsEvents(rows: Row[], opts: TaskFeedOptions = {}): IcsEvent[] {
  const events: IcsEvent[] = [];
  for (const row of rows) {
    const dueDate = str(row["dueDate"]);
    if (!dueDate) continue;
    if (isClosed(str(row["status"]))) continue;
    if (opts.mineFor) {
      const a = norm(str(row["assignee"]));
      if (!a || !opts.mineFor.some((w) => w && norm(w) === a)) continue;
    }
    const milestone = isMilestone(row);
    const title = str(row["title"]) || "(untitled)";
    events.push({
      uid: `issue-${str(row["id"])}@omniproject`,
      summary: `${milestone ? "◆ " : ""}${title}`,
      start: dueDate,
      allDay: true,
      description: [milestone ? "Milestone" : "Deadline", str(row["status"]) && `Status: ${str(row["status"])}`].filter(Boolean).join(" · ") || undefined,
    });
  }
  return events;
}
