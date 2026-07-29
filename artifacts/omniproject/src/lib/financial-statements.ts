/**
 * Consolidated financial statements (finance superset F9) — a derive-only roll-up of the finance figures
 * OmniProject actually holds at the project level: a PROFIT & LOSS view (income vs cost → gross profit +
 * margin) and a RECEIVABLES view (invoiced vs still-to-bill), both computed live from the canonical
 * `revenue` / `actualCost` / `invoicedAmount` fields the backend surfaces. Pure — nothing is stored.
 *
 * The balance sheet, cash-flow statement and aged AP that a full finance suite adds are GL/banking-backed:
 * they populate only when a backend implementing the ledger/banking contract verbs (F7/F8) is connected and
 * returning that data, so the report is honest about what a project-only dataset can show.
 */

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** One costed/earning work item (a loose read shadow of the money fields on an Issue). */
export interface StatementItem {
  revenue?: number | null;
  actualCost?: number | null;
  invoicedAmount?: number | null;
}

export interface FinancialStatements {
  /** Σ revenue — projected/earned income. */
  income: number;
  /** Σ actualCost — cost of delivery. */
  cost: number;
  /** income − cost. */
  grossProfit: number;
  /** grossProfit as a whole-number % of income (0 when there's no income). */
  marginPct: number;
  /** Σ invoicedAmount — billed to date. */
  invoiced: number;
  /** income − invoiced, floored at 0 — earned but not yet billed (a receivables proxy). */
  unbilled: number;
  /** How many items carry any of income / cost / invoiced (the finance surface). */
  count: number;
}

/** Roll a project's work items into the consolidated P&L + receivables figures. Pure and total. */
export function summariseStatements(items: readonly StatementItem[]): FinancialStatements {
  let income = 0;
  let cost = 0;
  let invoiced = 0;
  let count = 0;
  for (const it of items) {
    const r = num(it.revenue);
    const c = num(it.actualCost);
    const inv = num(it.invoicedAmount);
    income += r;
    cost += c;
    invoiced += inv;
    if (r !== 0 || c !== 0 || inv !== 0) count += 1;
  }
  const grossProfit = income - cost;
  const marginPct = income > 0 ? Math.round((grossProfit / income) * 100) : 0;
  const unbilled = Math.max(0, income - invoiced);
  return { income, cost, grossProfit, marginPct, invoiced, unbilled, count };
}
