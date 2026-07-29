import { useMemo } from "react";
import { useGetTasks, type Task } from "@workspace/api-client-react";
import { planMyDay, type PlanTask } from "@workspace/backend-catalogue";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { ReportEmpty } from "./ReportEmpty";

/**
 * My Day — the ranked "these are the things worth committing to today" list, via the shared `planMyDay`
 * catalogue engine: overdue → due-today → high-priority → flagged tasks, worst-first, over the live GTD task
 * feed. The engine never calls `Date`, so the current time is passed in (a `now` test-seam prop defaulting to
 * `Date.now()`). Derive-only — nothing is stored.
 */
const ms = (iso: unknown): number | null => {
  if (typeof iso !== "string" || !iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

export function PlanMyDay({ projectId, now }: { projectId: string; now?: number }) {
  const { data: tasks, isLoading, isError, error, refetch } = useGetTasks({ projectId });
  const asOf = now ?? Date.now();

  const { plan, summary } = useMemo(() => {
    const items: PlanTask[] = ((tasks ?? []) as Task[]).map((t) => ({
      id: t.id,
      status: t.status,
      dueDate: ms(t.dueDate),
      priority: t.priority ?? null,
      energy: t.energy ?? null,
      estimateHours: t.estimateHours ?? null,
    }));
    return planMyDay(items, { now: asOf });
  }, [tasks, asOf]);

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {plan.length === 0 ? (
        <ReportEmpty testId="plan-my-day-empty">
          Nothing due or flagged for today — My Day fills with overdue, due-today, high-priority and flagged tasks.
        </ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid="plan-my-day">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Today" value={String(summary.picked)} />
            <StatCard label="Overdue" value={String(summary.overdue)} />
            <StatCard label="Due today" value={String(summary.dueToday)} />
            <StatCard label="Est. hours" value={String(summary.totalEstimateHours)} />
          </div>
          <ol className="space-y-1">
            {plan.map((p, i) => (
              <li key={p.id} className="flex items-center gap-3 text-sm" data-testid={`plan-row-${p.id}`}>
                <span className="tabular-nums text-xs text-muted-foreground w-6 text-right">{i + 1}</span>
                <span className="font-mono text-xs w-40 truncate" title={p.id}>{p.id}</span>
                <span className="flex-1 text-muted-foreground">{p.reason}</span>
                <span className="tabular-nums text-xs text-muted-foreground w-16 text-right">
                  {p.estimateHours ? `${p.estimateHours}h` : ""}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </DataState>
  );
}
