import {
  useGetProjectHistory,
  useGetProjectBaseline,
} from "@workspace/api-client-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ProvenanceBadge } from "../ProvenanceBadge";

/**
 * Progress trend, sourced from the system of record via n8n (get_project_history).
 * OmniProject keeps no history of its own — in demo mode the points are derived
 * from current issue state and clearly badged so nothing reads as recorded fact.
 */
export function ProjectTrend({ projectId }: { projectId: string }) {
  const { data: history, isLoading } = useGetProjectHistory(projectId);
  const { data: baseline } = useGetProjectBaseline(projectId);

  const points = history ?? [];
  const provenance = points[0]?.provenance;

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Progress Trend</h2>
        <ProvenanceBadge provenance={provenance} />
      </div>

      <div className="bg-card border border-border p-4">
        {isLoading ? (
          <div className="h-56 flex items-center justify-center text-muted-foreground animate-pulse font-bold tracking-widest">LOADING…</div>
        ) : points.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">No history available from the backend.</div>
        ) : (
          <>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={points} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
                  <defs>
                    <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" />
                  <XAxis dataKey="date" stroke="currentColor" className="text-muted-foreground" fontSize={10} />
                  <YAxis stroke="currentColor" className="text-muted-foreground" fontSize={11} domain={[0, 100]} unit="%" />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                  <Area type="monotone" dataKey="completionRate" stroke="#22c55e" strokeWidth={2} fill="url(#trendFill)" name="Completion %" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex items-center justify-between text-[11px] font-mono text-muted-foreground">
              <span>{points.length} points · latest {points.at(-1)?.completionRate}% complete</span>
              {baseline ? (
                <span title={baseline.name}>Baseline: {new Date(baseline.capturedAt).toLocaleDateString()} · {baseline.items.length} items</span>
              ) : (
                <span>No baseline captured by the backend</span>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
