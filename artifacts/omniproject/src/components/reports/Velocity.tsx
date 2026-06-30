import { useGetProjectHistory } from "@workspace/api-client-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { ProvenanceBadge } from "../ProvenanceBadge";
import { DataState } from "../DataState";
import { velocitySeries, meanVelocity } from "../../lib/progress-charts";

/**
 * Velocity / throughput — work completed in each period (the per-period delta of completed count),
 * with the mean as a reference line. Derived from the backend's project history; nothing stored.
 */
export function Velocity({ projectId }: { projectId: string }) {
  const { data: history, isLoading, isError, error, refetch } = useGetProjectHistory(projectId);
  const points = history ?? [];
  const series = velocitySeries(points);
  const mean = meanVelocity(series);
  const provenance = points[0]?.provenance;

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Velocity / Throughput</h2>
        <ProvenanceBadge provenance={provenance} />
      </div>
      <div className="bg-card border border-border p-4">
        <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} loadingClassName="h-56 flex items-center justify-center" className="h-56">
          {series.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">Not enough history to chart throughput.</div>
          ) : (
            <>
              <div className="h-56" data-testid="velocity-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={series} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" />
                    <XAxis dataKey="period" stroke="currentColor" className="text-muted-foreground" fontSize={10} />
                    <YAxis stroke="currentColor" className="text-muted-foreground" fontSize={11} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                    <ReferenceLine y={mean} stroke="#6366f1" strokeDasharray="5 4" />
                    <Bar dataKey="completed" fill="#6366f1" name="Completed" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 text-[11px] font-mono text-muted-foreground">Mean {mean} completed / period over {series.length} periods.</div>
            </>
          )}
        </DataState>
      </div>
    </section>
  );
}
