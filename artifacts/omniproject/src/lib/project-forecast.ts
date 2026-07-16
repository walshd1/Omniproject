import { type WorkingCalendar } from "./working-calendar";
import { autoSchedule, type AutoScheduleResult, type ScheduledTask } from "./auto-schedule";
import { issuesToScheduleTasks, dependencyEdgesToTyped, type ScheduleIssue, type ScheduleTaskOptions } from "./schedule-adapter";
import { type DependencyEdge } from "./dependencies";

/**
 * Project forecast (roadmap 3.1 slice 5) — the pure glue that runs the auto-scheduler over ONE project's
 * live issues + its dependency overlay and returns a ready-to-render forecast. Keeps all the maths out of
 * the React component (which just fetches + renders), matching the codebase pattern. Pure + projected:
 * given the same issues + edges + calendar it always yields the same plan; nothing is written back.
 */

/** A forecast issue = the scheduler's issue shape plus a title for display. */
export type ForecastIssue = ScheduleIssue & { title: string };

/** One row of the forecast, sorted earliest-start first for display. */
export interface ForecastRow extends ScheduledTask {
  title: string;
}

export interface ProjectForecast {
  result: AutoScheduleResult;
  rows: ForecastRow[];
  projectStartDay: number;
}

/** The project's start floor: the earliest anchored task start, else `nowDay`. */
export function resolveProjectStartDay(tasks: ReadonlyArray<{ earliestStartDay?: number }>, nowDay: number): number {
  let min = Infinity;
  for (const t of tasks) if (t.earliestStartDay !== undefined && t.earliestStartDay < min) min = t.earliestStartDay;
  return Number.isFinite(min) ? min : nowDay;
}

/**
 * Compute a project's auto-scheduled forecast. `nowDay` is the whole-day fallback floor for tasks with no
 * anchoring date (pass `Math.floor(Date.now() / DAY_MS)` from the component; injected here so the maths
 * stays deterministic and testable).
 */
export function computeProjectForecast(
  cal: WorkingCalendar,
  issues: readonly ForecastIssue[],
  edges: readonly DependencyEdge[],
  projectId: string,
  nowDay: number,
  opts: ScheduleTaskOptions = {},
): ProjectForecast {
  const ids = new Set(issues.map((i) => i.id));
  const tasks = issuesToScheduleTasks(cal, issues, opts);
  const dependencies = dependencyEdgesToTyped(edges, projectId, ids);
  const projectStartDay = resolveProjectStartDay(tasks, nowDay);
  const result = autoSchedule(cal, { tasks, dependencies, projectStartDay });

  const titleOf = new Map(issues.map((i) => [i.id, i.title]));
  const rows: ForecastRow[] = result.order
    .map((id) => ({ ...result.tasks[id]!, title: titleOf.get(id) ?? id }))
    .sort((a, b) => a.startDay - b.startDay || b.durationWorkingDays - a.durationWorkingDays);

  return { result, rows, projectStartDay };
}
