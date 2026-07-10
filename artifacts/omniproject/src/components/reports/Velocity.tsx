import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { ProjectHistoryChart } from "./ProjectHistoryChart";
import { axisTheme, gridTheme, chartTooltipStyle } from "./chart-theme";
import { velocitySeries, meanVelocity } from "../../lib/progress-charts";

/**
 * Velocity / throughput — work completed in each period (the per-period delta of completed count),
 * with the mean as a reference line. Derived from the backend's project history; nothing stored.
 */
export function Velocity({ projectId }: { projectId: string }) {
  return (
    <ProjectHistoryChart
      projectId={projectId}
      title="Velocity / Throughput"
      emptyMessage="Not enough history to chart throughput."
      testId="velocity-chart"
      select={(points) => velocitySeries(points)}
      footer={(series) => (
        <div className="mt-3 text-[11px] font-mono text-muted-foreground">
          Mean {meanVelocity(series)} completed / period over {series.length} periods.
        </div>
      )}
    >
      {(series) => (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={series} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
            <CartesianGrid {...gridTheme} />
            <XAxis dataKey="period" {...axisTheme} fontSize={10} />
            <YAxis {...axisTheme} fontSize={11} allowDecimals={false} />
            <Tooltip contentStyle={chartTooltipStyle} />
            <ReferenceLine y={meanVelocity(series)} stroke="#6366f1" strokeDasharray="5 4" />
            <Bar dataKey="completed" fill="#6366f1" name="Completed" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ProjectHistoryChart>
  );
}
