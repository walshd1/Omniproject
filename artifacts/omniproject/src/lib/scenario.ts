import type { Project, PortfolioHealthSummary } from "@workspace/api-client-react";
import { num } from "./num";

/**
 * What-If scenario engine — a STATELESS, in-browser overlay on the LIVE
 * portfolio read-model. It forks the data we already have (project
 * issueCount/completedCount, portfolio RAG/variance/blocker rows) into local
 * copies, applies a few coarse levers, and reports the aggregate delta. It is
 * NOT a project/task model: no new fields, no broker call, no persistence.
 * Everything here is pure so the maths is fully unit-testable.
 */

/** Coarse levers a planner can nudge per project. All optional, all additive. */
export interface ScenarioAdjustment {
  /** Shift implied completion by this many percentage points (e.g. +10). */
  completionDeltaPct?: number;
  /** Add this many days to the schedule variance (− = ahead, + = behind). */
  scheduleDeltaDays?: number;
  /** Add this many percentage points to the budget variance. */
  budgetDeltaPct?: number;
  /** Add/remove active blockers (clamped at ≥ 0). */
  blockersDelta?: number;
}

/** Adjustments keyed by projectId. Absent key ⇒ that project is untouched. */
export type ScenarioAdjustments = Record<string, ScenarioAdjustment>;

/** Aggregate KPIs for one snapshot of the read-model. */
export interface ScenarioSummary {
  completionPct: number;
  avgScheduleVarianceDays: number;
  avgBudgetVariancePct: number;
  totalBlockers: number;
  ragCounts: { RED: number; AMBER: number; GREEN: number };
}

/** Per-metric deltas (scenario − base). */
export interface SummaryDiff {
  completionPct: number;
  avgScheduleVarianceDays: number;
  avgBudgetVariancePct: number;
  totalBlockers: number;
  ragCounts: { RED: number; AMBER: number; GREEN: number };
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Completion % implied by a project's issue/completed counts. */
function baseCompletionPct(issueCount: number, completedCount: number): number {
  return issueCount > 0 ? (completedCount / issueCount) * 100 : 0;
}

/**
 * Apply `adjustments` to copies of `projects` and `portfolio`. Inputs are never
 * mutated. Completion is re-derived into completedCount and clamped to
 * [0, issueCount]; blockers are clamped at ≥ 0; schedule/budget deltas add to
 * the variance numbers.
 */
export function applyScenario(
  projects: Project[],
  portfolio: PortfolioHealthSummary[],
  adjustments: ScenarioAdjustments,
): { projects: Project[]; portfolio: PortfolioHealthSummary[] } {
  const adjustedProjects = projects.map((p) => {
    const adj = adjustments[p.id];
    if (!adj || adj.completionDeltaPct == null) return { ...p };
    const issueCount = p.issueCount ?? 0;
    const base = baseCompletionPct(issueCount, p.completedCount ?? 0);
    const targetPct = base + adj.completionDeltaPct;
    const completedCount = clamp(Math.round((issueCount * targetPct) / 100), 0, issueCount);
    return { ...p, completedCount };
  });

  const adjustedPortfolio = portfolio.map((r) => {
    const adj = adjustments[r.projectId];
    if (!adj) return { ...r };
    return {
      ...r,
      scheduleVarianceDays: r.scheduleVarianceDays + (adj.scheduleDeltaDays ?? 0),
      budgetVariancePercentage: r.budgetVariancePercentage + (adj.budgetDeltaPct ?? 0),
      activeBlockersCount: Math.max(0, r.activeBlockersCount + (adj.blockersDelta ?? 0)),
    };
  });

  return { projects: adjustedProjects, portfolio: adjustedPortfolio };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
/** Mean over ONLY the finite values (a non-finite read-model figure is excluded from BOTH the sum and
 *  the count, not averaged in as 0), matching the server twin summarizeHealth. 0 when none are finite. */
const finiteAvg = (ns: readonly (number | null | undefined)[]): number => {
  const finite = ns.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : 0;
};

/** Aggregate KPIs across the given read-model copy. Division-by-zero guarded, and every figure is
 *  finite-coerced (num) / finite-filtered (finiteAvg) so one dirty read-model row — a NaN/undefined/
 *  string count or variance, which the read model genuinely delivers — can't poison the whole KPI to
 *  NaN (and the averages agree with the server's summarizeHealth). */
export function summarize(projects: Project[], portfolio: PortfolioHealthSummary[]): ScenarioSummary {
  const totalIssues = projects.reduce((s, p) => s + num(p.issueCount), 0);
  const totalCompleted = projects.reduce((s, p) => s + num(p.completedCount), 0);

  const ragCounts = { RED: 0, AMBER: 0, GREEN: 0 };
  for (const r of portfolio) {
    const key = String(r.ragStatus).toUpperCase();
    if (key === "RED" || key === "AMBER" || key === "GREEN") ragCounts[key] += 1;
  }

  return {
    completionPct: totalIssues > 0 ? round1((totalCompleted / totalIssues) * 100) : 0,
    avgScheduleVarianceDays: round1(finiteAvg(portfolio.map((r) => r.scheduleVarianceDays))),
    avgBudgetVariancePct: round1(finiteAvg(portfolio.map((r) => r.budgetVariancePercentage))),
    totalBlockers: portfolio.reduce((s, r) => s + num(r.activeBlockersCount), 0),
    ragCounts,
  };
}

/** Per-metric deltas (scenario − base). */
export function diffSummary(base: ScenarioSummary, scenario: ScenarioSummary): SummaryDiff {
  return {
    completionPct: round1(scenario.completionPct - base.completionPct),
    avgScheduleVarianceDays: round1(scenario.avgScheduleVarianceDays - base.avgScheduleVarianceDays),
    avgBudgetVariancePct: round1(scenario.avgBudgetVariancePct - base.avgBudgetVariancePct),
    totalBlockers: scenario.totalBlockers - base.totalBlockers,
    ragCounts: {
      RED: scenario.ragCounts.RED - base.ragCounts.RED,
      AMBER: scenario.ragCounts.AMBER - base.ragCounts.AMBER,
      GREEN: scenario.ragCounts.GREEN - base.ragCounts.GREEN,
    },
  };
}
