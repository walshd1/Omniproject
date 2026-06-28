import type { ActorContext, Broker, PortfolioRow } from "../broker/types";
import { mintAutonomousContext } from "./autonomous";
import { recordAudit } from "./audit";

/**
 * Health / anomaly watch.
 *
 * Scans the portfolio read model against a set of KPI rules and raises a notification
 * for each finding. It runs as the KEYED autonomous actor `automation:health-watch`
 * (minted per run, short-lived, RBAC-roled) so its broker reads are keyed and
 * provenance-bound like any principal. It is READ-ONLY by default — it only observes and
 * notifies; any change it might apply would go through the autonomous write-scope guard
 * (lib/autonomous-grant), default-deny.
 *
 * Rules are pure and declarative (testable without a broker); the runner is injectable
 * (broker + notify) so the whole pipeline is deterministically tested.
 */
export type Severity = "critical" | "warning" | "info";

export interface HealthFinding {
  ruleId: string;
  projectId: string;
  projectName: string;
  severity: Severity;
  message: string;
  at: string;
}

export interface Thresholds {
  /** Schedule slip (days late) at/above which to warn. */
  scheduleSlipDays: number;
  /** Budget overrun (%) at/above which to warn. */
  budgetOverrunPct: number;
  /** Active blockers at/above which to warn. */
  blockers: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { scheduleSlipDays: 5, budgetOverrunPct: 10, blockers: 1 };

interface HealthRule {
  id: string;
  severity: Severity;
  /** Returns a message when the rule fires for this row, else null. */
  evaluate(row: PortfolioRow, t: Thresholds): string | null;
}

/** The built-in KPI rules over portfolio-wide health (RAG, schedule, budget, blockers). */
export const HEALTH_RULES: HealthRule[] = [
  { id: "rag-red", severity: "critical", evaluate: (r) => (r.ragStatus?.toLowerCase() === "red" ? "RAG status is RED" : null) },
  { id: "rag-amber", severity: "warning", evaluate: (r) => (r.ragStatus?.toLowerCase() === "amber" ? "RAG status is amber" : null) },
  { id: "schedule-slip", severity: "warning", evaluate: (r, t) => (r.scheduleVarianceDays >= t.scheduleSlipDays ? `Schedule slipped ${r.scheduleVarianceDays} day(s)` : null) },
  { id: "budget-overrun", severity: "warning", evaluate: (r, t) => (r.budgetVariancePercentage >= t.budgetOverrunPct ? `Budget over by ${r.budgetVariancePercentage}%` : null) },
  { id: "blockers", severity: "warning", evaluate: (r, t) => (r.activeBlockersCount >= t.blockers ? `${r.activeBlockersCount} active blocker(s)` : null) },
];

/** Evaluate every rule against every portfolio row → findings (pure; `at` injected). */
export function evaluateHealth(rows: PortfolioRow[], at: string, thresholds: Thresholds = DEFAULT_THRESHOLDS, rules: HealthRule[] = HEALTH_RULES): HealthFinding[] {
  const findings: HealthFinding[] = [];
  for (const row of rows) {
    for (const rule of rules) {
      const message = rule.evaluate(row, thresholds);
      if (message) findings.push({ ruleId: rule.id, projectId: row.projectId, projectName: row.projectName, severity: rule.severity, message, at });
    }
  }
  return findings;
}

// RAM-only ring of recent findings (zero-at-rest; lost on restart).
const RING_MAX = 200;
const ring: HealthFinding[] = [];

/** The most recent findings (newest last). */
export function recentFindings(): HealthFinding[] {
  return [...ring];
}

/** Test-only: clear the findings ring. */
export function __resetHealthWatch(): void {
  ring.length = 0;
}

export type NotifyFn = (finding: HealthFinding) => void;

export interface RunOptions {
  now: number;
  broker: Broker;
  notify: NotifyFn;
  thresholds?: Thresholds;
}

/**
 * Run the watch: mint the keyed actor, read the portfolio THROUGH the broker as that
 * actor, evaluate the rules, notify per finding, and record the run. Returns the findings.
 */
export async function runHealthWatch(opts: RunOptions): Promise<HealthFinding[]> {
  // Keyed, short-lived, viewer-roled principal — reads are enough for a watch.
  const ctx: ActorContext = mintAutonomousContext({ id: "health-watch", role: "viewer", reason: "scheduled health scan" }, opts.now);
  const rows = await opts.broker.portfolioHealth(ctx);
  const at = new Date(opts.now).toISOString();
  const findings = evaluateHealth(rows, at, opts.thresholds);

  for (const f of findings) {
    opts.notify(f);
    ring.push(f);
    if (ring.length > RING_MAX) ring.shift();
  }

  recordAudit({
    ts: at, category: "autonomous", action: "health-watch.run",
    actor: { sub: ctx.sub, role: ctx.role }, write: false, result: "success",
    meta: { projects: rows.length, findings: findings.length },
  });
  return findings;
}
