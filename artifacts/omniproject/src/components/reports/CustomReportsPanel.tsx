import { useMemo } from "react";
import { useGetProjectIssues, getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { useCustomReports } from "../../lib/custom-reports-api";
import type { Row } from "../../lib/custom-report";
import { DataState } from "../DataState";
import { CustomReport } from "./CustomReport";
import { usePortfolioItems } from "./use-portfolio-items";

/** Render a list of bespoke reports of one scope over the supplied rows (each its own titled section). */
function CustomReportList({ scope, rows }: { scope: "project" | "portfolio"; rows: readonly Row[] }) {
  const { data: defs } = useCustomReports();
  const mine = (defs ?? []).filter((d) => d.scope === scope);
  if (mine.length === 0) return null;
  return (
    <div className="space-y-8" data-testid={`custom-reports-${scope}`}>
      {mine.map((def) => (
        <section key={def.id}>
          <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-4">{def.label}</h2>
          <CustomReport def={def} rows={rows} />
        </section>
      ))}
    </div>
  );
}

/** Project-scoped bespoke reports over the selected project's work items. */
export function CustomReportsProject({ projectId }: { projectId: string }) {
  const { data: issues, isLoading, isError, error, refetch } = useGetProjectIssues(projectId, { query: { queryKey: getGetProjectIssuesQueryKey(projectId) } });
  const rows = (issues ?? []) as Issue[] as unknown as Row[];
  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-0">
      <CustomReportList scope="project" rows={rows} />
    </DataState>
  );
}

/** Portfolio-scoped bespoke reports over every project's work items. */
export function CustomReportsPortfolio() {
  const { projects, loading, isError, error, refetch } = usePortfolioItems();
  const rows = useMemo(() => projects.flatMap((p) => p.items as unknown as Row[]), [projects]);
  return (
    <DataState isLoading={loading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-0">
      <CustomReportList scope="portfolio" rows={rows} />
    </DataState>
  );
}
