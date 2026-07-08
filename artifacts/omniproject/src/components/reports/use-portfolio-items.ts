import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useListProjects, useGetSettings, getGetProjectIssuesQueryOptions, type Issue, type FxRates } from "@workspace/api-client-react";
import { useFxRates, resolveFxAsOf, firstCurrency, DEFAULT_CURRENCY } from "../../lib/currency";
import type { ProjectItems } from "../../lib/portfolio-value";

/**
 * Shared fan-out for the portfolio value roll-ups (income + benefits): fetch every project's work items
 * (deduped via React Query with the other reports that read the same key), tag each with its programme +
 * currency, and resolve the reporting currency (org setting → FX base) and the FX as-of-date policy (org
 * setting → spot). One place so both reports read identically.
 */
export function usePortfolioItems(): {
  projects: ProjectItems[];
  loading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  target: string;
  rates: Record<string, number> | undefined;
  fx: FxRates | undefined;
} {
  const { data: projectList, isLoading: projLoading, isError, error, refetch } = useListProjects();
  const { data: settings } = useGetSettings();
  const { data: fx } = useFxRates(resolveFxAsOf(settings));

  const ids = useMemo(() => (projectList ?? []).map((p) => p.id), [projectList]);
  // `combine` keeps the result referentially stable across renders that don't change the
  // underlying query data — a bare useQueries() array gets a fresh reference every render, which
  // would re-run the O(projects) `projects` derivation below on every unrelated re-render (this
  // hook feeds 4+ report surfaces). See docs/PERF-PATTERNS-REVIEW.md, Theme C.
  const issuesByProject = useQueries({
    queries: ids.map((id) => getGetProjectIssuesQueryOptions(id)),
    combine: (results) => ({
      data: results.map((r) => r.data as Issue[] | undefined),
      isLoading: results.some((r) => r.isLoading),
    }),
  });
  const loading = projLoading || issuesByProject.isLoading;

  const projects = useMemo<ProjectItems[]>(() => {
    return (projectList ?? []).map((p, i) => {
      const items = issuesByProject.data[i] ?? [];
      return {
        projectId: p.id,
        projectName: p.name,
        programmeId: p.programmeId ?? null,
        programmeName: p.programmeName ?? null,
        currency: firstCurrency(items),
        items,
      };
    });
  }, [projectList, issuesByProject]);

  return { projects, loading, isError, error, refetch, target: settings?.reportingCurrency || fx?.base || DEFAULT_CURRENCY, rates: fx?.rates, fx };
}
