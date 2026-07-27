import { useMemo } from "react";
import { useGetProjectIssues, type Issue } from "@workspace/api-client-react";
import { computeSprintMetrics, type SprintItem } from "@workspace/backend-catalogue";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { ReportEmpty } from "./ReportEmpty";

/**
 * Sprint review — the per-iteration commit-vs-complete numbers every agile tool shows, via the shared
 * `computeSprintMetrics` catalogue engine: for each sprint, how much was COMMITTED vs COMPLETED, what was
 * ADDED mid-sprint (scope churn) and what CARRIED OVER, plus the resulting per-sprint velocity series. Items
 * are grouped by their `sprint` field; story points are the weight. Derive-only over the live issue list;
 * nothing stored.
 */
function pct(rate: number | null): string {
  return rate == null ? "—" : `${Math.round(rate * 100)}%`;
}

export function SprintReview({ projectId }: { projectId: string }) {
  const { data: issues, isLoading, isError, error, refetch } = useGetProjectIssues(projectId);

  const { sprints, summary } = useMemo(() => {
    const items: SprintItem[] = ((issues ?? []) as Issue[]).map((i) => ({
      id: i.id,
      sprintId: i.sprint ?? null,
      status: i.status,
      points: i.storyPoints ?? null,
    }));
    return computeSprintMetrics(items);
  }, [issues]);

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {sprints.length === 0 ? (
        <ReportEmpty testId="sprint-review-empty">
          No sprints yet — the sprint review builds from issues carrying a `sprint` field.
        </ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid="sprint-review">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Sprints" value={String(summary.sprints)} />
            <StatCard label="Mean velocity" value={String(summary.meanVelocity)} />
            <StatCard label="Completed pts" value={String(summary.completedPoints)} />
            <StatCard label="Completion rate" value={pct(summary.overallCompletionRate)} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3 font-black">Sprint</th>
                  <th className="py-2 px-3 font-black tabular-nums text-right">Committed</th>
                  <th className="py-2 px-3 font-black tabular-nums text-right">Completed</th>
                  <th className="py-2 px-3 font-black tabular-nums text-right">Added</th>
                  <th className="py-2 px-3 font-black tabular-nums text-right">Carryover</th>
                  <th className="py-2 pl-3 font-black tabular-nums text-right">Completion</th>
                </tr>
              </thead>
              <tbody>
                {sprints.map((s) => (
                  <tr key={s.sprintId} className="border-b border-border/40" data-testid={`sprint-row-${s.sprintId}`}>
                    <td className="py-2 pr-3 font-mono text-xs">{s.sprintId}</td>
                    <td className="py-2 px-3 tabular-nums text-right">{s.committedPoints}</td>
                    <td className="py-2 px-3 tabular-nums text-right">{s.completedPoints}</td>
                    <td className="py-2 px-3 tabular-nums text-right">{s.addedPoints}</td>
                    <td className="py-2 px-3 tabular-nums text-right">{s.carryoverPoints}</td>
                    <td className="py-2 pl-3 tabular-nums text-right">{pct(s.completionRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Velocity series (completed points per sprint): {summary.sprints === 0 ? "—" : sprints.map((s) => s.completedPoints).join(" · ")}
          </p>
        </div>
      )}
    </DataState>
  );
}
