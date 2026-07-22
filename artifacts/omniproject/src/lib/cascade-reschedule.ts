import { type WorkingCalendar } from "./working-calendar";
import { autoSchedule } from "./auto-schedule";
import { issuesToScheduleTasks, dependencyEdgesToTyped, type ScheduleIssue } from "./schedule-adapter";
import { type DependencyEdge } from "./dependencies";

/**
 * Drag-a-bar CASCADE (roadmap 3.1 slice 6) — the pure maths behind the Gantt's opt-in "cascade dependents"
 * mode. Given a user drag of one bar by `deltaDays`, it returns the day-shift to apply to EVERY affected
 * issue (the dragged one plus the dependents it pushes), so the caller can write them back through the
 * normal issue-update seam.
 *
 * Push-only semantics (matching the Schedule Sandbox): every task is anchored at its CURRENT position, so
 * nothing is pulled earlier — a task moves only if a predecessor's new finish pushes it. We isolate the
 * drag's effect by diffing two auto-schedule runs — a baseline (no drag) and one with the dragged task's
 * anchor bumped — so any pre-existing dependency slack in the current plan cancels out and only the knock-on
 * of THIS drag is written. Pure + projected; the caller decides whether/how to persist.
 */

/** A forecast/cascade issue = the scheduler's issue shape (id + dates + estimate). */
export type CascadeIssue = ScheduleIssue;

/**
 * Compute the per-issue day-shift caused by dragging `draggedId` by `deltaDays`. `currentStartById` gives
 * each issue's current whole-day start (from the Gantt lane), used to anchor the push-only floors. Returns
 * only the issues that actually move (non-zero shift); empty when the drag snaps to no movement.
 */
export function computeCascade(
  cal: WorkingCalendar,
  issues: readonly CascadeIssue[],
  edges: readonly DependencyEdge[],
  projectId: string,
  currentStartById: Readonly<Record<string, number>>,
  draggedId: string,
  deltaDays: number,
  hoursPerDay?: number,
): Map<string, number> {
  const out = new Map<string, number>();
  if (deltaDays === 0) return out;

  const ids = new Set(issues.map((i) => i.id));
  const dependencies = dependencyEdgesToTyped(edges, projectId, ids);

  // Anchor every task at its current position so the pass only ever pushes work later, never earlier.
  const base = issuesToScheduleTasks(cal, issues, {}, hoursPerDay).map((t) => ({
    ...t,
    earliestStartDay: currentStartById[t.id] ?? t.earliestStartDay ?? 0,
  }));
  const anchors = new Map(base.map((t) => [t.id, t.earliestStartDay]));
  const projectStartDay = Math.min(...base.map((t) => t.earliestStartDay));

  const baseline = autoSchedule(cal, { tasks: base, dependencies, projectStartDay });
  const dragged = base.map((t) =>
    t.id === draggedId ? { ...t, earliestStartDay: (anchors.get(t.id) ?? 0) + deltaDays } : t,
  );
  const moved = autoSchedule(cal, { tasks: dragged, dependencies, projectStartDay });

  for (const id of Object.keys(baseline.tasks)) {
    const shift = (moved.tasks[id]?.startDay ?? 0) - (baseline.tasks[id]?.startDay ?? 0);
    if (shift !== 0) out.set(id, shift);
  }
  return out;
}
