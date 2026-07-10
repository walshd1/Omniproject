import { useGetProjectBaseline } from "@workspace/api-client-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ProjectHistoryChart } from "./ProjectHistoryChart";
import { axisTheme, gridTheme, chartTooltipStyle } from "./chart-theme";

/**
 * Progress trend, sourced from the system of record via the broker (get_project_history).
 * OmniProject keeps no history of its own — in demo mode the points are derived
 * from current issue state and clearly badged so nothing reads as recorded fact.
 */
export function ProjectTrend({ projectId }: { projectId: string }) {
  const { data: baseline } = useGetProjectBaseline(projectId);

  return (
    <ProjectHistoryChart
      projectId={projectId}
      title="Progress Trend"
      emptyMessage="No history available from the backend."
      select={(points) => points}
      footer={(_series, points) => (
        <div className="mt-3 flex items-center justify-between text-[11px] font-mono text-muted-foreground">
          <span>
            {points.length} points · latest {points.at(-1)?.completionRate}% complete
          </span>
          {baseline ? (
            <span title={baseline.name}>
              Baseline: {new Date(baseline.capturedAt).toLocaleDateString()} · {baseline.items.length} items
            </span>
          ) : (
            <span>No baseline captured by the backend</span>
          )}
        </div>
      )}
    >
      {(points) => (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
            <defs>
              <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid {...gridTheme} />
            <XAxis dataKey="date" {...axisTheme} fontSize={10} />
            <YAxis {...axisTheme} fontSize={11} domain={[0, 100]} unit="%" />
            <Tooltip contentStyle={chartTooltipStyle} />
            <Area type="monotone" dataKey="completionRate" stroke="#22c55e" strokeWidth={2} fill="url(#trendFill)" name="Completion %" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </ProjectHistoryChart>
  );
}
