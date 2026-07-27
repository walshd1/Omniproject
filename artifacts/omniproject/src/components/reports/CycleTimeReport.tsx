import { useMemo } from "react";
import { useGetProjectIssues, type Issue } from "@workspace/api-client-react";
import { computeCycleTime, type CycleTimeItem, type Distribution } from "@workspace/backend-catalogue";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { ReportEmpty } from "./ReportEmpty";

/**
 * Cycle & lead time — the flow-time distribution (p50 / p85 / p95) over completed work items, via the shared
 * `computeCycleTime` catalogue engine. LEAD time is created → done; CYCLE time is started → done (shown when
 * a start date is set). Completion is taken as the last-update time of a done item — the standard signal when
 * a backend exposes no explicit resolved date. Derive-only over the live issue list; nothing stored.
 */
const ms = (iso: unknown): number | null => {
  if (typeof iso !== "string" || !iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

function DistributionPanel({ title, dist, testId }: { title: string; dist: Distribution; testId: string }) {
  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="text-xs font-black uppercase tracking-widest text-muted-foreground">
        {title} <span className="font-normal normal-case">· {dist.count} items · days</span>
      </div>
      {dist.count === 0 ? (
        <p className="text-sm text-muted-foreground">No completed items with the required dates.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Median (p50)" value={String(dist.p50 ?? "—")} />
          <StatCard label="p85 (SLE)" value={String(dist.p85 ?? "—")} />
          <StatCard label="p95" value={String(dist.p95 ?? "—")} />
          <StatCard label="Mean" value={String(dist.mean ?? "—")} />
        </div>
      )}
    </div>
  );
}

export function CycleTimeReport({ projectId }: { projectId: string }) {
  const { data: issues, isLoading, isError, error, refetch } = useGetProjectIssues(projectId);

  const result = useMemo(() => {
    const rows: CycleTimeItem[] = ((issues ?? []) as Issue[]).map((i) => ({
      id: i.id,
      status: i.status,
      createdAt: ms(i.createdAt),
      // No explicit resolved date on the issue contract: a done item's completion is its last-update time.
      completedAt: ms(i.updatedAt),
      startedAt: ms(i.startDate),
    }));
    return computeCycleTime(rows);
  }, [issues]);

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {result.doneItems === 0 ? (
        <ReportEmpty testId="cycle-time-empty">
          No completed work items yet — cycle &amp; lead time populate as issues reach a done status.
        </ReportEmpty>
      ) : (
        <div className="space-y-5" data-testid="cycle-time">
          <DistributionPanel title="Lead time (created → done)" dist={result.leadTime} testId="lead-time" />
          <DistributionPanel title="Cycle time (started → done)" dist={result.cycleTime} testId="cycle-time-panel" />
          <p className="text-xs text-muted-foreground">
            {result.doneItems} completed items. Completion is taken as each item&apos;s last-update time (no resolved date on the issue feed).
          </p>
        </div>
      )}
    </DataState>
  );
}
