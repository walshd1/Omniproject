import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useListProjects, useGetSettings, getGetProjectIssuesQueryOptions, type Issue } from "@workspace/api-client-react";
import { useFxRates, firstCurrency } from "../../lib/currency";
import type { ProjectItems } from "../../lib/portfolio-value";

/**
 * Shared fan-out for the portfolio value roll-ups (income + benefits): fetch every project's work items
 * (deduped via React Query with the other reports that read the same key), tag each with its programme +
 * currency, and resolve the reporting currency (org setting → FX base). One place so both reports read
 * identically.
 */
export function usePortfolioItems(): {
  projects: ProjectItems[];
  loading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  target: string;
  rates: Record<string, number> | undefined;
} {
  const { data: projectList, isLoading: projLoading, isError, error, refetch } = useListProjects();
  const { data: fx } = useFxRates();
  const { data: settings } = useGetSettings();

  const ids = useMemo(() => (projectList ?? []).map((p) => p.id), [projectList]);
  const issueQueries = useQueries({ queries: ids.map((id) => getGetProjectIssuesQueryOptions(id)) });
  const loading = projLoading || issueQueries.some((q) => q.isLoading);

  const projects = useMemo<ProjectItems[]>(() => {
    return (projectList ?? []).map((p, i) => {
      const items = (issueQueries[i]?.data as Issue[] | undefined) ?? [];
      return {
        projectId: p.id,
        projectName: p.name,
        programmeId: p.programmeId ?? null,
        programmeName: p.programmeName ?? null,
        currency: firstCurrency(items),
        items,
      };
    });
  }, [projectList, issueQueries]);

  return { projects, loading, isError, error, refetch, target: settings?.reportingCurrency || fx?.base || "GBP", rates: fx?.rates };
}
