/**
 * TASK URGENCY + STALENESS — pure render rules over a next-action's dates. A list/board colours each row
 * by how pressing it is (from `dueDate`) and flags ones that have gone stale (from the last-touched date),
 * so "what needs attention" reads at a glance. No clock here — the reference `today` is injected so the
 * rules are deterministic + unit-testable; the caller passes `new Date()` at the render edge. UTC-day maths,
 * so a due date lands on the same calendar day in any timezone.
 */

/** A minimal task shape these rules read (everything optional — a task may carry none of these). */
export interface UrgencyTask {
  dueDate?: string | null;
  completedAt?: string | null;
  status?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  startDate?: string | null;
}

/** The urgency band a due date falls in (or "none" when there's no due date / the task is done). */
export type UrgencyBand = "overdue" | "due-today" | "due-soon" | "scheduled" | "none";

const DAY_MS = 86_400_000;
const dayOf = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
const todayDay = (today: Date): number => Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

/** Whole days from `today` until the task's due date (negative = overdue). Null when there's no due date. */
export function daysUntilDue(task: UrgencyTask, today: Date): number | null {
  const due = dayOf(task.dueDate);
  if (due === null) return null;
  return Math.round((due - todayDay(today)) / DAY_MS);
}

/** True when the task is closed (completed stamp set, or a done/dropped-ish status). */
export function isTaskClosed(task: UrgencyTask): boolean {
  if (task.completedAt) return true;
  const s = (task.status ?? "").toLowerCase();
  return s === "done" || s === "dropped" || s === "cancelled";
}

/**
 * The urgency band for a task, `soonDays` (default 3) being the window that counts as "due soon". A closed
 * task or one with no due date is "none"; past → "overdue"; today → "due-today"; within the window →
 * "due-soon"; further out → "scheduled".
 */
export function taskUrgency(task: UrgencyTask, today: Date, soonDays = 3): UrgencyBand {
  if (isTaskClosed(task)) return "none";
  const d = daysUntilDue(task, today);
  if (d === null) return "none";
  if (d < 0) return "overdue";
  if (d === 0) return "due-today";
  if (d <= soonDays) return "due-soon";
  return "scheduled";
}

/** The task's last-touched day: updatedAt, else completedAt/startDate/createdAt — whichever is present. */
function lastTouched(task: UrgencyTask): number | null {
  return dayOf(task.updatedAt) ?? dayOf(task.completedAt) ?? dayOf(task.startDate) ?? dayOf(task.createdAt);
}

/**
 * True when an OPEN task hasn't been touched in `staleDays` (default 14) — the "untouched tasks" flag that
 * surfaces things quietly rotting. False for a closed task, or when no timestamp is available to judge by
 * (we never flag what we can't measure).
 */
export function isUntouched(task: UrgencyTask, today: Date, staleDays = 14): boolean {
  if (isTaskClosed(task)) return false;
  const touched = lastTouched(task);
  if (touched === null) return false;
  return (todayDay(today) - touched) / DAY_MS >= staleDays;
}

/** The full attention read for a task in one call — band + staleness + days-to-due. */
export function taskAttention(task: UrgencyTask, today: Date, opts: { soonDays?: number; staleDays?: number } = {}): {
  band: UrgencyBand;
  untouched: boolean;
  daysUntilDue: number | null;
} {
  return {
    band: taskUrgency(task, today, opts.soonDays ?? 3),
    untouched: isUntouched(task, today, opts.staleDays ?? 14),
    daysUntilDue: daysUntilDue(task, today),
  };
}
