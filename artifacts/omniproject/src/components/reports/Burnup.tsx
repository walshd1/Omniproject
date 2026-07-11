import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ProjectHistoryChart } from "./ProjectHistoryChart";
import { axisTheme, gridTheme, chartTooltipStyle } from "./chart-theme";
import { burnupSeries } from "../../lib/progress-charts";

/**
 * Burnup — completed work rising toward the total scope line, so scope growth is visible (unlike a
 * burndown). Derived from the backend's project history; OmniProject stores nothing.
 */
export function Burnup({ projectId }: { projectId: string }) {
  return (
    <ProjectHistoryChart
      projectId={projectId}
      title="Burnup"
      emptyMessage="No history available from the backend."
      testId="burnup-chart"
      select={(points) => burnupSeries(points)}
    >
      {(series) => (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
            <CartesianGrid {...gridTheme} />
            <XAxis dataKey="date" {...axisTheme} fontSize={10} />
            <YAxis {...axisTheme} fontSize={11} allowDecimals={false} />
            <Tooltip contentStyle={chartTooltipStyle} />
            <Line type="monotone" dataKey="scope" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 4" dot={false} name="Scope" />
            <Line type="monotone" dataKey="completed" stroke="#22c55e" strokeWidth={2} dot={false} name="Completed" />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ProjectHistoryChart>
  );
}
