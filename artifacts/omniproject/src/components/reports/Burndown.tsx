import { useGetProjectHistory } from "@workspace/api-client-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ProvenanceBadge } from "../ProvenanceBadge";
import { DataState } from "../DataState";
import { burndownSeries } from "../../lib/progress-charts";

/**
 * Sprint burndown — remaining work vs the ideal line, derived from the backend's project history
 * (get_project_history). OmniProject stores no history; in demo mode the points are clearly badged.
 */
export function Burndown({ projectId }: { projectId: string }) {
  const { data: history, isLoading, isError, error, refetch } = useGetProjectHistory(projectId);
  const points = history ?? [];
  const series = burndownSeries(points);
  const provenance = points[0]?.provenance;

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Sprint Burndown</h2>
        <ProvenanceBadge provenance={provenance} />
      </div>
      <div className="bg-card border border-border p-4">
        <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} loadingClassName="h-56 flex items-center justify-center" className="h-56">
          {series.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">No history available from the backend.</div>
          ) : (
            <div className="h-56" data-testid="burndown-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" />
                  <XAxis dataKey="date" stroke="currentColor" className="text-muted-foreground" fontSize={10} />
                  <YAxis stroke="currentColor" className="text-muted-foreground" fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                  <Line type="monotone" dataKey="ideal" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 4" dot={false} name="Ideal" />
                  <Line type="monotone" dataKey="remaining" stroke="#ef4444" strokeWidth={2} dot={false} name="Remaining" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </DataState>
      </div>
    </section>
  );
}
