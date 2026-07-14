import { ProjectHistoryChart } from "./ProjectHistoryChart";
import { ChartView } from "../charts/ChartView";
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
      select={velocitySeries}
      footer={(series) => (
        <div className="mt-3 text-[11px] font-mono text-muted-foreground">
          Mean {meanVelocity(series)} completed / period over {series.length} periods.
        </div>
      )}
    >
      {(series) => (
        <ChartView
          type="bar"
          orientation="vertical"
          height="100%"
          legend={false}
          data={series.map((p) => ({ name: p.period, completed: p.completed }))}
          series={[{ key: "completed", label: "Completed" }]}
          referenceLines={[{ value: meanVelocity(series) }]}
        />
      )}
    </ProjectHistoryChart>
  );
}
