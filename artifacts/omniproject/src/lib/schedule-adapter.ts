import { type Issue } from "@workspace/api-client-react";
import { type WorkingCalendar, isoToDay, nextWorkingDay, workingDaysBetween } from "./working-calendar";
import { type ScheduleTask } from "./auto-schedule";
import { type TypedDependency, type TaskConstraint } from "./schedule-constraints";
import { type DependencyEdge } from "./dependencies";

/**
 * Adapter seam (roadmap 3.1 slice 4) — bridges the app's real data model (live `Issue`s + the volatile
 * dependency overlay) into the pure auto-scheduler's inputs. This is the ONE place the scheduler touches
 * app types, so the engine (`working-calendar` / `schedule-constraints` / `auto-schedule`) stays free of
 * them and independently testable. Pure + projected, mirroring `CriticalPath`'s derivation but in
 * WORKING days (so durations respect the calendar).
 *
 * The current dependency model is coarse (`blocks` / `depends_on` / `relates_to`, no FS/SS/FF/SF, no lag),
 * so every asserted edge maps to a finish-to-start (FS) precedence with zero lag — the natural default;
 * richer typed edges + lag can layer on later without changing this seam's shape.
 */

/** Default hours in a working day when no org config is supplied. */
export const DEFAULT_HOURS_PER_DAY = 8;

/** The minimal issue shape the scheduler needs. */
export type ScheduleIssue = Pick<Issue, "id" | "startDate" | "dueDate" | "estimateHours">;

/** Options for shaping tasks — per-issue date constraints (from a future UI / customFields). */
export interface ScheduleTaskOptions {
  constraints?: Record<string, TaskConstraint>;
}

/**
 * Working-day duration for an issue: the inclusive start→due working-day span if both dates exist, else
 * estimate ÷ 8h, else 0 (a milestone). Mirrors `CriticalPath.durationDays` but counts working days only.
 */
export function issueDurationWorkingDays(cal: WorkingCalendar, issue: ScheduleIssue, hoursPerDay: number = DEFAULT_HOURS_PER_DAY): number {
  const s = issue.startDate ? isoToDay(String(issue.startDate)) : NaN;
  const d = issue.dueDate ? isoToDay(String(issue.dueDate)) : NaN;
  if (Number.isFinite(s) && Number.isFinite(d) && d >= s) {
    return Math.max(1, workingDaysBetween(cal, s, d + 1)); // half-open [s, d+1) = inclusive [s, d]
  }
  const est = issue.estimateHours ?? 0;
  const perDay = hoursPerDay > 0 ? hoursPerDay : DEFAULT_HOURS_PER_DAY;
  if (est > 0) return Math.max(1, Math.round(est / perDay));
  return 0;
}

/**
 * Build auto-scheduler tasks from live issues. An issue's own `startDate` (snapped to a working day) becomes
 * its `earliestStartDay` floor so it anchors where it currently sits; a per-issue constraint can be supplied.
 */
export function issuesToScheduleTasks(
  cal: WorkingCalendar,
  issues: readonly ScheduleIssue[],
  opts: ScheduleTaskOptions = {},
  hoursPerDay: number = DEFAULT_HOURS_PER_DAY,
): ScheduleTask[] {
  return issues.map((issue) => {
    const start = issue.startDate ? isoToDay(String(issue.startDate)) : NaN;
    const constraint = opts.constraints?.[issue.id];
    return {
      id: issue.id,
      durationWorkingDays: issueDurationWorkingDays(cal, issue, hoursPerDay),
      ...(Number.isFinite(start) ? { earliestStartDay: nextWorkingDay(cal, start) } : {}),
      ...(constraint ? { constraint } : {}),
    };
  });
}

/**
 * Map the dependency overlay to typed precedence within one project. `blocks` means from→to (from finishes
 * before to starts); `depends_on` is the reverse; `relates_to` carries no order. Only edges whose BOTH
 * endpoints are issues in this project's set are kept. Every edge is FS with zero lag (the model has no type).
 */
export function dependencyEdgesToTyped(
  edges: readonly DependencyEdge[],
  projectId: string,
  ids: ReadonlySet<string>,
): TypedDependency[] {
  const out: TypedDependency[] = [];
  for (const e of edges) {
    if (e.from.projectRef !== projectId || e.to.projectRef !== projectId) continue;
    if (!ids.has(e.from.itemRef) || !ids.has(e.to.itemRef)) continue;
    if (e.type === "blocks") out.push({ predecessorId: e.from.itemRef, successorId: e.to.itemRef, kind: "FS", lagWorkingDays: 0 });
    else if (e.type === "depends_on") out.push({ predecessorId: e.to.itemRef, successorId: e.from.itemRef, kind: "FS", lagWorkingDays: 0 });
    // relates_to → no precedence
  }
  return out;
}
