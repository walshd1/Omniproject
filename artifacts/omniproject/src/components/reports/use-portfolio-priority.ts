import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  getGetProjectFinancialsQueryOptions,
  getGetProjectCapacityQueryOptions,
  type ProjectFinancials,
  type ResourceCapacity,
} from "@workspace/api-client-react";
import { convertAmount, isConvertible } from "../../lib/currency";
import { usePortfolioItems } from "./use-portfolio-items";
import { usePriorityWeights, DEFAULT_PRIORITY_WEIGHTS } from "../../lib/priority-weights-api";
import { scorePortfolio, type ProjectPriorityInput, type ProjectPriorityScore, type PriorityWeights } from "../../lib/portfolio-priority";
import { num } from "../../lib/num";

/**
 * Fan-out + score for the Portfolio Prioritisation report: reuses the shared issues fan-out
 * (usePortfolioItems — RICE/WSJF/MoSCoW/strategic/benefit fields), adds a financials fan-out (cost) and
 * a capacity fan-out (resourcing footprint), converts cost into the reporting currency, and runs the
 * pure `scorePortfolio` over the result. Every `useQueries` uses `combine` to keep a stable reference
 * across unrelated re-renders (see docs/PERF-PATTERNS-REVIEW.md, Theme C) so the O(projects) scoring
 * pass doesn't re-run on every keystroke elsewhere on the page.
 */
export function usePortfolioPriority(): {
  scored: ProjectPriorityScore[];
  weights: PriorityWeights;
  loading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  target: string;
} {
  const { projects, loading: itemsLoading, isError, error, refetch, target, rates } = usePortfolioItems();
  const { data: weights } = usePriorityWeights();

  const ids = useMemo(() => projects.map((p) => p.projectId), [projects]);

  const finByProject = useQueries({
    queries: ids.map((id) => getGetProjectFinancialsQueryOptions(id)),
    combine: (results) => ({
      data: results.map((r) => r.data as ProjectFinancials | undefined),
      isLoading: results.some((r) => r.isLoading),
    }),
  });

  const capByProject = useQueries({
    queries: ids.map((id) => getGetProjectCapacityQueryOptions(id)),
    combine: (results) => ({
      data: results.map((r) => r.data as ResourceCapacity[] | undefined),
      isLoading: results.some((r) => r.isLoading),
    }),
  });

  const loading = itemsLoading || finByProject.isLoading || capByProject.isLoading;

  const scored = useMemo(() => {
    const inputs: ProjectPriorityInput[] = projects.map((p, i) => {
      const fin = finByProject.data[i];
      const finCur = String(fin?.currency ?? "");
      // A KNOWN foreign budget currency with no FX rate to the reporting currency would otherwise pass
      // its RAW amount through unchanged (convertAmount's no-rate fallback), inflating this project's
      // cost — which distorts value-density, the funded-cost scenario total and the greedy funding
      // pick. Treat that as unknown cost (0), the same state a project with no financials already has.
      // An empty currency is assumed to already be in the reporting currency (unchanged behaviour).
      const cost = fin && (finCur === "" || isConvertible(finCur, target, rates))
        ? convertAmount(num(fin.budgetAllocated), finCur, target, rates)
        : 0;
      const capacityHours = (capByProject.data[i] ?? []).reduce((s, r) => s + num(r.assignedHours), 0);
      return {
        projectId: p.projectId,
        projectName: p.projectName,
        programmeId: p.programmeId,
        programmeName: p.programmeName,
        items: p.items,
        cost,
        capacityHours,
      };
    });
    return scorePortfolio(inputs, weights ?? DEFAULT_PRIORITY_WEIGHTS);
  }, [projects, finByProject, capByProject, target, rates, weights]);

  return { scored, weights: weights ?? DEFAULT_PRIORITY_WEIGHTS, loading, isError, error, refetch, target };
}
