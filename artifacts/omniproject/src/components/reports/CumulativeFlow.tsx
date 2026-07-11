import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ProjectHistoryChart } from "./ProjectHistoryChart";
import { axisTheme, gridTheme, chartTooltipStyle } from "./chart-theme";
import { cumulativeFlowSeries } from "../../lib/progress-charts";

/**
 * Cumulative flow — completed vs still-remaining work stacked over time (the two-band CFD a
 * total/completed history supports). Derived from the backend's project history; nothing stored.
 */
export function CumulativeFlow({ projectId }: { projectId: string }) {
  return (
    <ProjectHistoryChart
      projectId={projectId}
      title="Cumulative Flow"
      emptyMessage="No history available from the backend."
      testId="cumulative-flow-chart"
      select={(points) => cumulativeFlowSeries(points)}
    >
      {(series) => (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
            <CartesianGrid {...gridTheme} />
            <XAxis dataKey="date" {...axisTheme} fontSize={10} />
            <YAxis {...axisTheme} fontSize={11} allowDecimals={false} />
            <Tooltip contentStyle={chartTooltipStyle} />
            <Area type="monotone" stackId="1" dataKey="completed" stroke="#22c55e" fill="#22c55e" fillOpacity={0.5} name="Completed" />
            <Area type="monotone" stackId="1" dataKey="remaining" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.3} name="Remaining" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </ProjectHistoryChart>
  );
}
