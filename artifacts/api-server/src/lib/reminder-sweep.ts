import type { Task } from "../broker/types";
import { isTaskClosed } from "../broker/vocabulary";

/**
 * Active reminder delivery. A task's `reminderAt` was only ever exposed as an iCal VALARM (the user's
 * calendar app fired it); this delivers reminders IN-APP: a sweep finds tasks whose reminder time has
 * passed, pushes a notification to the assignee, and records each as fired so it never re-fires. The pure
 * selection + the injected runner live here (no I/O); the route wires the runner to the broker read, the
 * notify bus and the shared-state dedupe, and a cron/routine drives the sweep on a cadence.
 */

/** The one-time fire key for a task's current reminder — includes the timestamp so RESCHEDULING (a new
 *  reminderAt) is a fresh reminder that fires again, while the same one never double-fires. */
export function reminderFireKey(task: Pick<Task, "id" | "reminderAt">): string {
  return `reminder:fired:${task.id}:${task.reminderAt ?? ""}`;
}

/** Tasks whose reminder is DUE at `nowMs`: a reminderAt in the past, not done/dropped, not already fired. Pure. */
export function dueReminders(tasks: readonly Task[], nowMs: number, isFired: (key: string) => boolean): Task[] {
  return tasks.filter((t) => {
    if (!t.reminderAt) return false;
    const at = Date.parse(t.reminderAt);
    if (Number.isNaN(at) || at > nowMs) return false;
    if (isTaskClosed(t.status)) return false; // no reminders for finished/dropped work
    return !isFired(reminderFireKey(t));
  });
}

/** A reminder notification for a task + the target derived from its assignee (email addressing when the
 *  assignee is an email; otherwise untargeted — delivered to the task's watchers by the hub). */
export function reminderNotification(task: Task): { notification: { kind: string; title: string; body: string }; target: { sub?: string; email?: string } } {
  const assignee = task.assignee ?? "";
  const target = assignee.includes("@") ? { email: assignee } : {};
  return {
    notification: { kind: "reminder", title: `Reminder: ${task.title}`, body: task.dueDate ? `Due ${task.dueDate}` : "Reminder" },
    target,
  };
}

export interface ReminderSweepDeps {
  tasks: readonly Task[];
  nowMs: number;
  /** Cheap pre-filter: has this reminder already fired? Best-effort — the authoritative gate is `claim`. */
  isFired: (key: string) => boolean | Promise<boolean>;
  /** ATOMIC set-if-absent. Returns true iff THIS sweep claimed the key (it was not already set), in which
   *  case this sweep — and only this sweep — must deliver. Concurrent/overlapping/multi-replica sweeps that
   *  lose the race get false and skip, so a reminder is delivered exactly once fleet-wide. */
  claim: (key: string) => boolean | Promise<boolean>;
  notify: (n: { kind: string; title: string; body: string }, target: { sub?: string; email?: string }) => void | Promise<void>;
}

/**
 * Run one reminder sweep: deliver every due reminder exactly once. Correctness under overlapping/multi-replica
 * sweeps rests on `claim` being an ATOMIC set-if-absent (only the winner delivers) — the up-front `isFired`
 * read is just a cheap pre-filter, never the dedupe gate. Returns the count delivered by THIS sweep.
 */
export async function runReminderSweep(deps: ReminderSweepDeps): Promise<{ fired: number; taskIds: string[] }> {
  const flags = new Map<string, boolean>();
  for (const t of deps.tasks) {
    if (t.reminderAt) flags.set(reminderFireKey(t), !!(await deps.isFired(reminderFireKey(t))));
  }
  const due = dueReminders(deps.tasks, deps.nowMs, (k) => flags.get(k) ?? false);
  const taskIds: string[] = [];
  for (const t of due) {
    if (!(await deps.claim(reminderFireKey(t)))) continue; // lost the atomic claim → another sweep delivers
    const { notification, target } = reminderNotification(t);
    await deps.notify(notification, target);
    taskIds.push(t.id);
  }
  return { fired: taskIds.length, taskIds };
}
