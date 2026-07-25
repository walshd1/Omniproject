import { useMemo, type ReactNode } from "react";
import { useGetProjectHistory, type ProjectHistoryPoint } from "@workspace/api-client-react";
import { ProvenanceBadge } from "../ProvenanceBadge";
import { DataState } from "../DataState";

/** A single point of the backend-sourced project history (as returned by the history hook). */
type HistoryPoint = ProjectHistoryPoint;

interface ProjectHistoryChartProps<T> {
  projectId: string;
  /** Section heading (rendered next to the provenance badge). */
  title: string;
  /** Message shown when the derived series is empty. */
  emptyMessage: string;
  /** Derive the chart series from the raw history points. */
  select: (points: HistoryPoint[]) => T[];
  /** `data-testid` on the chart frame (omit to match the trend chart, which had none). */
  testId?: string;
  /** Render the Recharts chart from the derived series — wrapped in the shared `h-56` frame. */
  children: (series: T[], points: HistoryPoint[]) => ReactNode;
  /** Optional footer rendered below the chart (mean line, point count, baseline, …). */
  footer?: (series: T[], points: HistoryPoint[]) => ReactNode;
}

/**
 * The shared scaffold every project-history chart re-inlined: the `useGetProjectHistory` fetch, the
 * `<section>` + heading + `ProvenanceBadge`, the card frame, the `DataState` (loading/error) and the
 * empty-state, all sized to the standard `h-56`. Each chart supplies only what differs — a title, an
 * empty message, the series transform, the Recharts body and an optional footer — so Burnup /
 * Burndown / Velocity / CumulativeFlow / ProjectTrend stop repeating the wrapper five times.
 *
 * OmniProject stores no history; the points come from the backend via the broker
 * (get_project_history) and their provenance is badged.
 */
export function ProjectHistoryChart<T>({
  projectId,
  title,
  emptyMessage,
  select,
  testId,
  children,
  footer,
}: ProjectHistoryChartProps<T>) {
  const { data, isLoading, isError, error, refetch } = useGetProjectHistory(projectId);
  const points = data ?? [];
  // Fold `data ?? []` INSIDE the memo and depend on `data`, not `points` — `points` is a fresh array
  // each render (when data is undefined), which would thrash this memo. `data` is react-query-stable.
  const series = useMemo(() => select(data ?? []), [select, data]);
  const provenance = points[0]?.provenance;

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">{title}</h2>
        <ProvenanceBadge provenance={provenance} />
      </div>
      <div className="bg-card border border-border p-4">
        <DataState
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={() => refetch()}
          loadingClassName="h-56 flex items-center justify-center"
          className="h-56"
        >
          {series.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">{emptyMessage}</div>
          ) : (
            <>
              <div className="h-56" data-testid={testId}>
                {children(series, points)}
              </div>
              {footer?.(series, points)}
            </>
          )}
        </DataState>
      </div>
    </section>
  );
}
