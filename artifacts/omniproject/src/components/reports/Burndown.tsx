import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ProjectHistoryChart } from "./ProjectHistoryChart";
import { axisTheme, gridTheme, chartTooltipStyle } from "./chart-theme";
import { burndownSeries } from "../../lib/progress-charts";

/**
 * Sprint burndown — remaining work vs the ideal line, derived from the backend's project history
 * (get_project_history). OmniProject stores no history; in demo mode the points are clearly badged.
 */
export function Burndown({ projectId }: { projectId: string }) {
  return (
    <ProjectHistoryChart
      projectId={projectId}
      title="Sprint Burndown"
      emptyMessage="No history available from the backend."
      testId="burndown-chart"
      select={(points) => burndownSeries(points)}
    >
      {(series) => (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
            <CartesianGrid {...gridTheme} />
            <XAxis dataKey="date" {...axisTheme} fontSize={10} />
            <YAxis {...axisTheme} fontSize={11} allowDecimals={false} />
            <Tooltip contentStyle={chartTooltipStyle} />
            <Line type="monotone" dataKey="ideal" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 4" dot={false} name="Ideal" />
            <Line type="monotone" dataKey="remaining" stroke="#ef4444" strokeWidth={2} dot={false} name="Remaining" />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ProjectHistoryChart>
  );
}
