import { configResource } from "./config-resource";

/**
 * Budget-plans client. A budget plan is a project's time-phased planned budget in a single currency
 * (the planning side of financials), stored as shared config via /api/budget-plans. Reads are open to any
 * authenticated user; writes are gated to `manager` server-side. The Budgets SCREEN renders the roll-ups
 * (/api/budget-plans/rows) generically; this client is for the Settings admin editor that owns the CONTENT.
 */
export interface BudgetPeriod {
  period: string;
  amount: number;
}

export interface BudgetPlan {
  id: string;
  projectId: string;
  currency: string;
  periods: BudgetPeriod[];
}

export const budgetPlansQueryKey = ["budget-plans"] as const;

const resource = configResource<BudgetPlan[]>({
  queryKey: budgetPlansQueryKey,
  path: "/api/budget-plans",
  envelopeKey: "budgetPlans",
  empty: [],
  saveErrorMessage: "Failed to save budget plans", // manager-gated server-side
  // The screen panels read the rows endpoint under their own per-panel query keys; drop those too.
  alsoInvalidate: [["panel-data"]],
});
export const useBudgetPlans = resource.useResource;
/** Persist the full budget-plans list (CSRF attached by the global fetch patch). Manager-gated server-side. */
export const useSaveBudgetPlans = resource.useSaveResource;
