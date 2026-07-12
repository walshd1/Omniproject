import { ProjectHistoryChart } from "./ProjectHistoryChart";
import { ChartView } from "../charts/ChartView";
import { burnupSeries } from "../../lib/progress-charts";

/**
 * Burnup — completed work rising toward the total scope line, so scope growth is visible (unlike a
 * burndown). Derived from the backend's project history; OmniProject stores nothing. Drawn through
 * the common ChartView renderer.
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
        <ChartView
          type="line"
          height="100%"
          xKey="date"
          data={series as unknown as { name: string }[]}
          series={[{ key: "scope", label: "Scope" }, { key: "completed", label: "Completed" }]}
        />
      )}
    </ProjectHistoryChart>
  );
}
