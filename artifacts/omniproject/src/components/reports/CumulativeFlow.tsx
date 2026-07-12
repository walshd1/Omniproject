import { ProjectHistoryChart } from "./ProjectHistoryChart";
import { ChartView } from "../charts/ChartView";
import { cumulativeFlowSeries } from "../../lib/progress-charts";

/**
 * Cumulative flow — completed vs still-remaining work stacked over time (the two-band CFD a
 * total/completed history supports). Derived from the backend's project history; nothing stored.
 * Drawn through the common ChartView renderer.
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
        <ChartView
          type="area"
          stacked
          height="100%"
          xKey="date"
          data={series as unknown as { name: string }[]}
          series={[{ key: "completed", label: "Completed" }, { key: "remaining", label: "Remaining" }]}
        />
      )}
    </ProjectHistoryChart>
  );
}
