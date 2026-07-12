import { useMemo } from "react";
import { useGetProjectIssues, getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { useCustomReports } from "../../lib/custom-reports-api";
import { useTasks, type Task } from "../../lib/tasks";
import type { Row } from "../../lib/custom-report";
import { DataState } from "../DataState";
import { CustomReport } from "./CustomReport";
import { ArtifactRenderer } from "../artifact/ArtifactRenderer";
import { BUILTIN_ARTIFACTS, type BuiltinArtifactDef } from "../../definitions";
import { usePortfolioItems } from "./use-portfolio-items";

/** The shipped baseline report artifacts whose spec targets a given scope — the read-only JSON defs from
 *  src/definitions/builtin/artifacts that draw through the report engine on the Reports page. */
export function baselineReportsForScope(scope: "project" | "portfolio" | "tasks"): BuiltinArtifactDef[] {
  return BUILTIN_ARTIFACTS.filter((a) => a.kind === "report" && (a.spec as { scope?: string }).scope === scope);
}

/** Render bespoke + shipped-baseline reports of one scope over the supplied rows (each its own titled
 *  section). Both draw through the same report engine, so a shipped drop-in appears here with no bespoke
 *  code. */
function CustomReportList({ scope, rows }: { scope: "project" | "portfolio" | "tasks"; rows: readonly Row[] }) {
  const { data: defs } = useCustomReports();
  const mine = (defs ?? []).filter((d) => d.scope === scope);
  const baseline = baselineReportsForScope(scope);
  if (mine.length === 0 && baseline.length === 0) return null;
  return (
    <div className="space-y-8" data-testid={`custom-reports-${scope}`}>
      {baseline.map((a) => (
        <section key={a.id} data-testid={`builtin-report-${a.id}`}>
          <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-4">
            {a.label} <span className="text-[10px] font-bold text-muted-foreground/70">· shipped</span>
          </h2>
          <ArtifactRenderer def={a} rows={rows} />
        </section>
      ))}
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

/** Task-scoped bespoke reports over the GTD task entity (portfolio-wide) — the report analogue of the
 *  view engine's task views, using the same task field catalog. */
export function CustomReportsTasks() {
  const { data: tasks, isLoading, isError, error, refetch } = useTasks();
  const rows = (tasks ?? []) as Task[] as unknown as Row[];
  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-0">
      <CustomReportList scope="tasks" rows={rows} />
    </DataState>
  );
}
