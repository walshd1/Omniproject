import type { PortfolioHealthSummary } from "@workspace/api-client-react";
import { numLoose as num } from "./num";

/**
 * Executive / board reporting pack — the portfolio-wide summary a head of projects puts in front of a
 * board: the RAG spread, the exceptions that need a decision, and the headline financials. Pure
 * derivations over the read model (portfolio health + consolidated financials); nothing is stored.
 */

export type Rag = "GREEN" | "AMBER" | "RED";

export interface ExecException {
  projectId: string;
  projectName: string;
  rag: Rag;
  scheduleVarianceDays: number;
  budgetVariancePercentage: number;
  activeBlockersCount: number;
}

export interface ExecHealth {
  rag: Record<Rag, number>;
  total: number;
  /** Share of the portfolio that is AMBER or RED (0..1). */
  atRiskPct: number;
  totalBlockers: number;
  /** Worst schedule slip across the portfolio (most-negative days; 0 if none slipping). */
  worstSlipDays: number;
  /** Exceptions (RED + AMBER), most-severe first — the board's "needs attention" list. */
  exceptions: ExecException[];
}

const RANK: Record<Rag, number> = { RED: 0, AMBER: 1, GREEN: 2 };

/** Severity ordering: RED before AMBER, then more blockers, bigger schedule slip, then budget overrun. */
function bySeverity(a: ExecException, b: ExecException): number {
  return (
    RANK[a.rag] - RANK[b.rag] ||
    b.activeBlockersCount - a.activeBlockersCount ||
    a.scheduleVarianceDays - b.scheduleVarianceDays ||
    b.budgetVariancePercentage - a.budgetVariancePercentage ||
    // Stable final tiebreaker: projectId is the composite source:id upstream, so two
    // equally-severe exceptions always sort deterministically (never order-of-arrival).
    a.projectId.localeCompare(b.projectId)
  );
}

/** Roll portfolio-health rows into the board's health summary. */
export function buildExecHealth(health: PortfolioHealthSummary[]): ExecHealth {
  const rag: Record<Rag, number> = { GREEN: 0, AMBER: 0, RED: 0 };
  let totalBlockers = 0;
  let worstSlipDays = 0;
  const exceptions: ExecException[] = [];

  for (const h of health) {
    // The read model is untrusted: rag can arrive in any casing, and the numeric fields can arrive
    // as strings/null/NaN. Normalise before rolling up so one dirty row can't poison the board totals.
    const rawRag = String(h.ragStatus ?? "").toUpperCase();
    const r: Rag = rawRag === "RED" || rawRag === "AMBER" ? (rawRag as Rag) : "GREEN";
    const slip = num(h.scheduleVarianceDays);
    const blockers = num(h.activeBlockersCount);
    rag[r] += 1;
    totalBlockers += blockers;
    if (slip < worstSlipDays) worstSlipDays = slip;
    if (r !== "GREEN") {
      exceptions.push({
        projectId: String(h.projectId ?? ""),
        projectName: String(h.projectName ?? ""),
        rag: r,
        scheduleVarianceDays: slip,
        budgetVariancePercentage: num(h.budgetVariancePercentage),
        activeBlockersCount: blockers,
      });
    }
  }

  const total = health.length;
  exceptions.sort(bySeverity);
  return { rag, total, atRiskPct: total ? (rag.AMBER + rag.RED) / total : 0, totalBlockers, worstSlipDays, exceptions };
}

/** A one-line board narrative summarising the portfolio's posture. */
export function execHeadline(h: ExecHealth): string {
  if (h.total === 0) return "No projects in the portfolio.";
  const onTrack = h.rag.GREEN;
  const atRisk = h.rag.AMBER + h.rag.RED;
  const slip = h.worstSlipDays < 0 ? `, worst slip ${h.worstSlipDays}d` : "";
  return `${onTrack}/${h.total} on track; ${atRisk} need attention (${h.rag.RED} red, ${h.rag.AMBER} amber)${slip}; ${h.totalBlockers} active blocker(s).`;
}
