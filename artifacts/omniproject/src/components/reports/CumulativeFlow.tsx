import { useGetProjectHistory } from "@workspace/api-client-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ProvenanceBadge } from "../ProvenanceBadge";
import { DataState } from "../DataState";
import { cumulativeFlowSeries } from "../../lib/progress-charts";

/**
 * Cumulative flow — completed vs still-remaining work stacked over time (the two-band CFD a
 * total/completed history supports). Derived from the backend's project history; nothing stored.
 */
export function CumulativeFlow({ projectId }: { projectId: string }) {
  const { data: history, isLoading, isError, error, refetch } = useGetProjectHistory(projectId);
  const points = history ?? [];
  const series = cumulativeFlowSeries(points);
  const provenance = points[0]?.provenance;

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Cumulative Flow</h2>
        <ProvenanceBadge provenance={provenance} />
      </div>
      <div className="bg-card border border-border p-4">
        <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} loadingClassName="h-56 flex items-center justify-center" className="h-56">
          {series.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">No history available from the backend.</div>
          ) : (
            <div className="h-56" data-testid="cumulative-flow-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" />
                  <XAxis dataKey="date" stroke="currentColor" className="text-muted-foreground" fontSize={10} />
                  <YAxis stroke="currentColor" className="text-muted-foreground" fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                  <Area type="monotone" stackId="1" dataKey="completed" stroke="#22c55e" fill="#22c55e" fillOpacity={0.5} name="Completed" />
                  <Area type="monotone" stackId="1" dataKey="remaining" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.3} name="Remaining" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </DataState>
      </div>
    </section>
  );
}
