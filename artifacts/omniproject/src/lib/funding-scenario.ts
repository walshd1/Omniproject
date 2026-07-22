import { num, round1 } from "./num";
import type { ProjectPriorityScore } from "./portfolio-priority";

/**
 * Funding what-if — a STATELESS, pure overlay on the ranked portfolio (portfolio-priority.ts): fund /
 * defer / cut each project and see the resulting budget, capacity and benefit impact. Mirrors the
 * existing what-if sandboxes (scenario.ts, schedule-scenario.ts): a decision map forked in local
 * memory, never written back to any backend. A project with no explicit decision defaults to "fund"
 * (the status-quo baseline — "keep everything funded unless told otherwise").
 */

export type FundingDecision = "fund" | "defer" | "cut";

/** Decisions keyed by projectId. A missing key defaults to "fund" (status quo). */
export type FundingDecisions = Record<string, FundingDecision>;

export function decisionFor(decisions: FundingDecisions, projectId: string): FundingDecision {
  return decisions[projectId] ?? "fund";
}

export interface FundingTotals {
  fundedCount: number;
  deferredCount: number;
  cutCount: number;
  fundedCost: number;
  deferredCost: number;
  cutCost: number;
  fundedCapacityHours: number;
  fundedBenefit: number;
  deferredBenefit: number;
  cutBenefit: number;
  /** Σ compositeScore across funded projects — the portfolio value actually being bought this cycle. */
  fundedScore: number;
}


/** Roll every project's decision up into portfolio totals: cost/capacity/benefit funded vs given up. */
export function summariseFunding(scored: readonly ProjectPriorityScore[], decisions: FundingDecisions): FundingTotals {
  const t: FundingTotals = {
    fundedCount: 0, deferredCount: 0, cutCount: 0,
    fundedCost: 0, deferredCost: 0, cutCost: 0,
    fundedCapacityHours: 0, fundedBenefit: 0, deferredBenefit: 0, cutBenefit: 0,
    fundedScore: 0,
  };
  for (const p of scored) {
    const cost = num(p.cost);
    const benefit = num(p.benefitValue);
    switch (decisionFor(decisions, p.projectId)) {
      case "fund":
        t.fundedCount += 1; t.fundedCost += cost; t.fundedCapacityHours += num(p.capacityHours);
        t.fundedBenefit += benefit; t.fundedScore += num(p.compositeScore);
        break;
      case "defer":
        t.deferredCount += 1; t.deferredCost += cost; t.deferredBenefit += benefit;
        break;
      case "cut":
        t.cutCount += 1; t.cutCost += cost; t.cutBenefit += benefit;
        break;
    }
  }
  return {
    ...t,
    fundedCost: round1(t.fundedCost), deferredCost: round1(t.deferredCost), cutCost: round1(t.cutCost),
    fundedCapacityHours: round1(t.fundedCapacityHours),
    fundedBenefit: round1(t.fundedBenefit), deferredBenefit: round1(t.deferredBenefit), cutBenefit: round1(t.cutBenefit),
    fundedScore: round1(t.fundedScore),
  };
}

export interface CapCheck {
  cap: number | null;
  used: number;
  /** cap − used; null when no cap is set. */
  remaining: number | null;
  /** max(0, used − cap); 0 when within cap or no cap set. */
  over: number;
}

function checkCap(cap: number | null, used: number): CapCheck {
  if (cap == null) return { cap: null, used: round1(used), remaining: null, over: 0 };
  return { cap, used: round1(used), remaining: round1(cap - used), over: round1(Math.max(0, used - cap)) };
}

export interface FundingScenarioResult {
  totals: FundingTotals;
  budget: CapCheck;
  capacity: CapCheck;
}

/** Evaluate a decision set against optional budget/capacity caps (null = uncapped — just report usage). */
export function evaluateFundingScenario(
  scored: readonly ProjectPriorityScore[],
  decisions: FundingDecisions,
  budgetCap: number | null,
  capacityCap: number | null,
): FundingScenarioResult {
  const totals = summariseFunding(scored, decisions);
  return { totals, budget: checkCap(budgetCap, totals.fundedCost), capacity: checkCap(capacityCap, totals.fundedCapacityHours) };
}

/** The "everything funded" baseline every scenario is compared against. */
export function fundAll(scored: readonly ProjectPriorityScore[]): FundingDecisions {
  return Object.fromEntries(scored.map((p) => [p.projectId, "fund" as const]));
}

/**
 * Greedily fund the top-ranked projects (by the score `scored` is already ordered on) until the next
 * project would push funded cost or funded capacity over its cap, then defer the rest. Pure — returns a
 * fresh decision map; never mutates `scored`. A project already marked "cut" stays cut (a cut is a
 * deliberate exclusion, not a capacity/budget deferral) — pass a `decisions` seed to preserve cuts.
 */
export function autoFundByRank(
  scored: readonly ProjectPriorityScore[],
  budgetCap: number | null,
  capacityCap: number | null,
  seed: FundingDecisions = {},
): FundingDecisions {
  const decisions: FundingDecisions = { ...seed };
  let usedCost = 0;
  let usedCapacity = 0;
  for (const p of scored) {
    if (decisions[p.projectId] === "cut") continue; // a deliberate cut is preserved, not re-funded
    const cost = num(p.cost);
    const capacity = num(p.capacityHours);
    const fitsBudget = budgetCap == null || usedCost + cost <= budgetCap;
    const fitsCapacity = capacityCap == null || usedCapacity + capacity <= capacityCap;
    if (fitsBudget && fitsCapacity) {
      decisions[p.projectId] = "fund";
      usedCost += cost;
      usedCapacity += capacity;
    } else {
      decisions[p.projectId] = "defer";
    }
  }
  return decisions;
}

/** Per-metric delta (scenario − baseline), the same idiom as scenario.ts's diffSummary — lets the UI
 *  show "what does this decision set cost us vs funding everything" without re-deriving totals twice. */
export interface FundingDelta {
  fundedCount: number;
  fundedCost: number;
  fundedCapacityHours: number;
  fundedBenefit: number;
  fundedScore: number;
}

export function diffFundingTotals(baseline: FundingTotals, scenario: FundingTotals): FundingDelta {
  return {
    fundedCount: scenario.fundedCount - baseline.fundedCount,
    fundedCost: round1(scenario.fundedCost - baseline.fundedCost),
    fundedCapacityHours: round1(scenario.fundedCapacityHours - baseline.fundedCapacityHours),
    fundedBenefit: round1(scenario.fundedBenefit - baseline.fundedBenefit),
    fundedScore: round1(scenario.fundedScore - baseline.fundedScore),
  };
}
