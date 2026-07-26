/**
 * RUN-RATE / BURN PROJECTION ENGINE — the lightweight cost forecast that needs no EVM baseline.
 *
 * EVM (evm.ts) is the full picture, but it demands earned value (EV) — a measured %-complete against a
 * baselined plan that most teams don't have early on. This engine is the pragmatic sibling every PMO
 * reaches for first: given only the approved budget, the actual spend to date, and how far through the
 * timeline you are, extrapolate a straight-line burn to completion and read the variance.
 *
 * Definitions (all money/effort in one unit; time as a fraction of the total window):
 *   runRate              = actualToDate / elapsedFraction      — spend per unit of the whole timeline
 *   projectedAtCompletion (PAC) = runRate                       — the run-rate extrapolated to elapsedFraction = 1
 *                        (equivalently actualToDate / elapsedFraction), the burn-to-date carried to the end
 *   variance             = projectedAtCompletion − budget       — +over / −under at completion
 *   variancePct          = variance / budget                    — signed, as a fraction of budget
 *   burnedPct            = actualToDate / budget                — how much of the budget is already spent
 *   requiredRunRate      = (budget − actualToDate) / (1 − elapsedFraction)
 *                          — the remaining-budget-per-remaining-timeline needed to LAND ON budget
 *                          (a burn-down analogue to EVM's TCPI; > runRate ⇒ you have slack, < ⇒ you must slow down)
 *
 * Every divide guards its denominator and returns `null` when undefined — never NaN/±Infinity. Same
 * discipline as evm.ts: ratios come from RAW inputs; only the returned scalars are rounded (money to
 * cents, fractions to 4 dp) so displayed numbers are stable without compounding rounding error. Pure, no I/O.
 */
import { round2 } from "./num";

export interface RunRateInput {
  /** Approved budget for the work (money or effort, one unit). */
  budget: number;
  /** Actual spend/effort booked so far. */
  actualToDate: number;
  /**
   * How far through the timeline you are, as a fraction in [0, 1] (elapsed / total).
   * Values outside [0, 1] are clamped; 0 (nothing elapsed) makes the projection undefined (null).
   */
  elapsedFraction: number;
}

export interface RunRateResult {
  budget: number;
  actualToDate: number;
  /** The clamped elapsed fraction actually used (input clamped to [0, 1]). */
  elapsedFraction: number;
  /** Spend per unit of the whole timeline (actualToDate / elapsedFraction). `null` when nothing has elapsed. */
  runRate: number | null;
  /** Straight-line projected spend at completion. `null` when nothing has elapsed. */
  projectedAtCompletion: number | null;
  /** projectedAtCompletion − budget (+over / −under). `null` when the projection is undefined. */
  variance: number | null;
  /** variance / budget, signed. `null` when the projection is undefined or the budget is 0. */
  variancePct: number | null;
  /** actualToDate / budget — fraction of budget already spent. `null` when the budget is 0. */
  burnedPct: number | null;
  /**
   * (budget − actualToDate) / (1 − elapsedFraction) — the run-rate needed over the remaining timeline to
   * finish exactly on budget. `null` when the timeline is complete (1 − elapsedFraction = 0).
   */
  requiredRunRate: number | null;
}

/** Round to 4 decimal places (fractions / ratios). */
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** A guarded ratio: `null` when the denominator is 0 (never NaN/±Infinity). */
const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

/**
 * Project spend-at-completion and variance from budget + actuals + elapsed fraction. `elapsedFraction`
 * is clamped to [0, 1]; a fully-unstarted window (elapsed 0) leaves the projection `null`, and a
 * zero budget leaves the percentage ratios `null`.
 */
export function computeRunRate(input: RunRateInput): RunRateResult {
  const { budget, actualToDate } = input;
  const elapsedFraction = Math.min(1, Math.max(0, input.elapsedFraction));
  const remainingFraction = 1 - elapsedFraction;

  // runRate = projectedAtCompletion here (straight-line): actualToDate carried to elapsedFraction = 1.
  const projectedRaw = ratio(actualToDate, elapsedFraction);
  const varianceRaw = projectedRaw === null ? null : projectedRaw - budget;
  // null when the projection is undefined OR the budget is 0 (ratio guards the 0 denominator).
  const variancePctRaw = varianceRaw === null ? null : ratio(varianceRaw, budget);
  const requiredRaw = ratio(budget - actualToDate, remainingFraction);
  const burnedRaw = ratio(actualToDate, budget);

  return {
    budget: round2(budget),
    actualToDate: round2(actualToDate),
    elapsedFraction: round4(elapsedFraction),
    runRate: projectedRaw === null ? null : round2(projectedRaw),
    projectedAtCompletion: projectedRaw === null ? null : round2(projectedRaw),
    variance: varianceRaw === null ? null : round2(varianceRaw),
    variancePct: variancePctRaw === null ? null : round4(variancePctRaw),
    burnedPct: burnedRaw === null ? null : round4(burnedRaw),
    requiredRunRate: requiredRaw === null ? null : round2(requiredRaw),
  };
}
