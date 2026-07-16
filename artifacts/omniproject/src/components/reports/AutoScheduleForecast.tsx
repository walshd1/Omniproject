import { useMemo } from "react";
import { useGetProjectIssues, getGetProjectIssuesQueryKey } from "@workspace/api-client-react";
import { useSchedulingSettings } from "../../lib/scheduling-settings";
import { DAY_MS, dayToShortDate } from "../../lib/date-utils";
import { computeProjectForecast, type ForecastIssue, type ForecastRow } from "../../lib/project-forecast";
import { loadEdges } from "../../lib/dependencies";
import { DataState } from "../DataState";
import { ReportEmpty } from "./ReportEmpty";
import { ReportTable } from "./ReportTable";

/**
 * Auto-scheduled forecast (roadmap 3.1 slice 5). STATELESS/projected: it runs the pure auto-scheduler
 * (working calendar + typed dependencies + constraints) over the project's live issues and its dependency
 * overlay, and shows where each activity would land at its earliest working-day start — plus the driver
 * that set each date and any breached constraint. Nothing is written back; given the same issues + edges it
 * always computes the same plan. Turn a forecast into reality by editing the real dates (e.g. on the Gantt).
 */
export function AutoScheduleForecast({ projectId }: { projectId: string }) {
  const { data: issues, isLoading, isError, error, refetch } = useGetProjectIssues(projectId, {
    query: { queryKey: getGetProjectIssuesQueryKey(projectId) },
  });
  const edges = useMemo(() => loadEdges(), []);
  const { hoursPerDay, calendar } = useSchedulingSettings();

  const { forecast, titleOf } = useMemo(() => {
    const list = (issues ?? []) as ForecastIssue[];
    const nowDay = Math.floor(Date.now() / DAY_MS);
    const fc = computeProjectForecast(calendar, list, edges, projectId, nowDay, {}, hoursPerDay);
    return { forecast: fc, titleOf: new Map(fc.rows.map((r) => [r.id, r.title])) };
  }, [issues, edges, projectId, calendar, hoursPerDay]);

  const { result, rows } = forecast;

  const columns = [
    { header: "Activity", cell: (r: ForecastRow) => <span className="font-medium" title={r.title}>{r.title}</span> },
    { header: "Start", align: "right" as const, cell: (r: ForecastRow) => dayToShortDate(r.startDay) },
    { header: "Finish", align: "right" as const, cell: (r: ForecastRow) => dayToShortDate(r.finishDay) },
    { header: "Working days", align: "right" as const, cell: (r: ForecastRow) => r.durationWorkingDays },
    { header: "Driven by", cell: (r: ForecastRow) => (r.driverId ? (titleOf.get(r.driverId) ?? r.driverId) : <span className="text-muted-foreground">—</span>) },
    {
      header: "Constraint",
      cell: (r: ForecastRow) => (r.violatesConstraint ? <span className="text-red-600 dark:text-red-500">⚠ breached</span> : <span className="text-muted-foreground">ok</span>),
    },
  ];

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {rows.length === 0 ? (
        <ReportEmpty testId="forecast-empty">
          No dated or estimated work to forecast yet — give work items a <strong>start/due</strong> or an{" "}
          <strong>estimate</strong>, and link them with <strong>blocks</strong> / <strong>depends&nbsp;on</strong> to
          see the cascade.
        </ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid="auto-schedule-forecast">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="border border-border bg-background p-3 text-center">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Projected finish</div>
              <div className="text-2xl font-black font-mono tabular-nums" data-testid="forecast-finish">{dayToShortDate(result.projectFinishDay)}</div>
            </div>
            <div className="border border-border bg-background p-3 text-center">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Activities</div>
              <div className="text-2xl font-black font-mono tabular-nums">{result.order.length}</div>
            </div>
            <div className="border border-border bg-background p-3 text-center">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Constraint breaches</div>
              <div className="text-2xl font-black font-mono tabular-nums" data-testid="forecast-violations">{result.violations.length}</div>
            </div>
          </div>

          {result.hasCycle && (
            <div role="alert" className="border border-amber-500/50 bg-amber-500/5 p-3 text-xs text-amber-600" data-testid="forecast-cycle">
              A dependency cycle was found — the looping links were ignored so every activity still gets a date. Break
              the loop for an accurate forecast.
            </div>
          )}

          <div role="note" className="text-[11px] text-muted-foreground">
            Projected earliest-start dates on your organisation's working calendar. A <em>projection only</em> —
            nothing is written back. Edit the real dates to commit a plan.
          </div>

          <ReportTable
            rows={rows}
            rowKey={(r) => r.id}
            rowTestId={(r) => `forecast-row-${r.id}`}
            columns={columns}
            rowClassName={(r) => (r.violatesConstraint ? "bg-red-500/5" : "")}
          />
        </div>
      )}
    </DataState>
  );
}
