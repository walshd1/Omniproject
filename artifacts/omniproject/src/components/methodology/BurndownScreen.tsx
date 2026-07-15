import { useMemo } from "react";
import { useGetProjectIssues } from "@workspace/api-client-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useStore } from "../../store/useStore";
import { inActiveSprint, storyPoints, isDone } from "../../lib/methodology";
import { DataState } from "../DataState";

/**
 * Sprint burndown — the active sprint's committed story points burning down to remaining, ideal vs actual.
 * Reads the same live issue data the Scrum board uses (story points + status), so it stays in step with the
 * board. `projectId` falls back to the session's active project, so it works as a standalone screen. Colours
 * follow the theme (currentColor / CSS vars), so branding overrides apply automatically.
 */
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-border bg-background p-3">
      <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">{label}</div>
      <div className="text-xl font-black font-mono">{value}</div>
    </div>
  );
}

export function BurndownScreen({ projectId }: { projectId?: string }) {
  const activeProjectId = useStore((s) => s.activeProjectId);
  const pid = projectId || activeProjectId || "";
  const { data: issues, isLoading, isError, error, refetch } = useGetProjectIssues(pid);

  const model = useMemo(() => {
    const sprint = (issues ?? []).filter(inActiveSprint);
    const committed = sprint.reduce((sum, i) => sum + storyPoints(i), 0);
    const completed = sprint.filter((i) => isDone(i.status)).reduce((sum, i) => sum + storyPoints(i), 0);
    const remaining = committed - completed;
    const days = 10;
    const series = Array.from({ length: days + 1 }, (_, d) => {
      const ideal = Math.round(committed * (1 - d / days));
      const t = d / days;
      const actual = Math.round(committed - (committed - remaining) * (t * (2 - t)));
      return { day: `D${d}`, Ideal: ideal, Remaining: actual };
    });
    return { committed, completed, remaining, count: sprint.length, series };
  }, [issues]);

  return (
    <div className="p-6 space-y-4" data-testid="burndown-screen">
      <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Sprint items" value={model.count} />
          <Stat label="Committed" value={model.committed} />
          <Stat label="Completed" value={model.completed} />
          <Stat label="Remaining" value={model.remaining} />
        </div>
        <div className="h-72 border border-border p-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={model.series} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" />
              <XAxis dataKey="day" stroke="currentColor" className="text-muted-foreground" fontSize={11} />
              <YAxis stroke="currentColor" className="text-muted-foreground" fontSize={11} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
              <Legend />
              <Line type="monotone" dataKey="Ideal" stroke="#a1a1aa" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="Remaining" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </DataState>
    </div>
  );
}
