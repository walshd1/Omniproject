/**
 * Multi-year / period budget planning — the DATA only. Financials were actuals + a derived forecast; this
 * adds the missing PLANNING side (SAP-class): an editable budget by period (quarter / year) per project.
 * Plans are stored as JSON in the per-deployment config store; this module owns the shape validator + a raw-
 * ROW emitter. It holds NO aggregation of its own — every roll-up ("budget by year / by project") is the ONE
 * generic `rollup` over these rows, driven by a JSON def, so the pattern matches every other system output.
 */

export class BudgetPlanError extends Error {
  constructor(message: string) { super(message); this.name = "BudgetPlanError"; }
}

/** Currency a plan falls back to when it omits `currency`. The deployment's reporting currency is passed in
 *  by the caller (settings) so this module stays a pure JSON constructor and never imports settings back
 *  — a static cycle would put BudgetPlanError in the TDZ and crash settings init. */
const FALLBACK_CURRENCY = "GBP";

/** One period's planned amount — `period` is a free label a deployment chooses ("2026", "2026-Q1", "2026-03"). */
export interface BudgetPeriod {
  period: string;
  amount: number;
}

/** A project's time-phased budget plan in a single currency. */
export interface BudgetPlan {
  id: string;
  projectId: string;
  currency: string;
  periods: BudgetPeriod[];
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Validate + normalise the stored budget-plan list. Pure — throws {@link BudgetPlanError}. `defaultCurrency`
 *  (the deployment's reporting currency, supplied by the caller) fills in a plan that omits `currency`, so a
 *  USD/EUR enterprise doesn't silently get GBP; when unset it falls back to {@link FALLBACK_CURRENCY}. */
export function validateBudgetPlans(value: unknown, defaultCurrency?: string): BudgetPlan[] {
  if (!Array.isArray(value)) throw new BudgetPlanError("budgetPlans must be an array");
  const fallback = str(defaultCurrency) || FALLBACK_CURRENCY;
  const ids = new Set<string>();
  return value.map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const id = str(o["id"]);
    const projectId = str(o["projectId"]);
    const currency = str(o["currency"]) || fallback;
    if (!id || !projectId) throw new BudgetPlanError("each budget plan needs id, projectId");
    if (ids.has(id)) throw new BudgetPlanError(`duplicate budget plan id "${id}"`);
    ids.add(id);
    if (!Array.isArray(o["periods"])) throw new BudgetPlanError(`budget plan "${id}" periods must be an array`);
    const seenPeriods = new Set<string>();
    const periods = (o["periods"] as unknown[]).map((pr) => {
      const p = (pr ?? {}) as Record<string, unknown>;
      const period = str(p["period"]);
      if (!period) throw new BudgetPlanError(`budget plan "${id}" has a period with no label`);
      if (seenPeriods.has(period)) throw new BudgetPlanError(`budget plan "${id}" has a duplicate period "${period}"`);
      seenPeriods.add(period);
      const amount = p["amount"];
      if (typeof amount !== "number" || !Number.isFinite(amount)) throw new BudgetPlanError(`budget plan "${id}" period "${period}" amount must be a number`);
      return { period, amount };
    });
    return { id, projectId, currency, periods };
  });
}

/** The plans flattened to GENERIC ROWS — one per (plan, period), with `year` derived from the period label —
 *  the artifact-agnostic table the generic `rollup` (and any renderer) groups / plots on the fly. */
export function budgetPeriodRows(plans: readonly BudgetPlan[]): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const plan of plans) {
    for (const p of plan.periods) {
      rows.push({ projectId: plan.projectId, currency: plan.currency, period: p.period, year: /^(\d{4})/.exec(p.period)?.[1] ?? "—", amount: p.amount });
    }
  }
  return rows;
}
