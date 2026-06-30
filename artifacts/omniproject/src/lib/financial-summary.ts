/**
 * Project financial summary — budget vs actual vs variance, rolled up from the work items the backend
 * already carries (the `financial` field group). Derive-only: OmniProject sums what the system of record
 * reports and stores nothing. Items with no budget/actual simply contribute zero, so a partially-costed
 * backlog still summarises cleanly.
 */

export interface CostedItem {
  budget?: number | null;
  actualCost?: number | null;
}

export interface FinancialSummary {
  /** Total approved budget across costed items. */
  budget: number;
  /** Total actual spend to date. */
  actual: number;
  /** budget − actual (positive = under budget). */
  variance: number;
  /** Actual as a percentage of budget (0 when there's no budget). */
  pctConsumed: number;
  /** How many items carry a budget or an actual (the costed surface). */
  costedItems: number;
}

const num = (v: number | null | undefined): number => (typeof v === "number" && isFinite(v) ? v : 0);

export function summariseFinancials(items: readonly CostedItem[]): FinancialSummary {
  let budget = 0;
  let actual = 0;
  let costedItems = 0;
  for (const i of items) {
    const b = num(i.budget);
    const a = num(i.actualCost);
    budget += b;
    actual += a;
    if (b !== 0 || a !== 0) costedItems += 1;
  }
  const variance = budget - actual;
  const pctConsumed = budget > 0 ? Math.round((actual / budget) * 100) : 0;
  return { budget, actual, variance, pctConsumed, costedItems };
}
