import { ProjectHistoryChart } from "./ProjectHistoryChart";
import { ChartView } from "../charts/ChartView";
import { burndownSeries } from "../../lib/progress-charts";

/**
 * Sprint burndown — remaining work vs the ideal line, derived from the backend's project history
 * (get_project_history). OmniProject stores no history; in demo mode the points are clearly badged.
 * Drawn through the common ChartView renderer (data over the shared primitives).
 */
export function Burndown({ projectId }: { projectId: string }) {
  return (
    <ProjectHistoryChart
      projectId={projectId}
      title="Sprint Burndown"
      emptyMessage="No history available from the backend."
      testId="burndown-chart"
      select={burndownSeries}
    >
      {(series) => (
        <ChartView
          type="line"
          height="100%"
          xKey="date"
          data={series as unknown as { name: string }[]}
          series={[{ key: "ideal", label: "Ideal" }, { key: "remaining", label: "Remaining" }]}
        />
      )}
    </ProjectHistoryChart>
  );
}
