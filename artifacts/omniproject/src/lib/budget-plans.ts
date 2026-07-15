import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

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

export function useBudgetPlans() {
  return useQuery({
    queryKey: budgetPlansQueryKey,
    queryFn: () => getJson<{ budgetPlans: BudgetPlan[] }>("/api/budget-plans").then((r) => r.budgetPlans ?? []),
    staleTime: 30_000,
  });
}

/** Persist the full budget-plans list (CSRF attached by the global fetch patch). Manager-gated server-side. */
export function useSaveBudgetPlans() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (budgetPlans: BudgetPlan[]) => {
      return sendJson<unknown>("/api/budget-plans", { budgetPlans }, "PUT", "Failed to save budget plans");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: budgetPlansQueryKey });
      // The screen panels read the rows endpoint under their own per-panel query keys; drop those too.
      qc.invalidateQueries({ queryKey: ["panel-data"] });
    },
  });
}
