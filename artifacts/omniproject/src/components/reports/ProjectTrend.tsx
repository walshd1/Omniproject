import { useGetProjectBaseline, type ProjectHistoryPoint } from "@workspace/api-client-react";
import { ProjectHistoryChart } from "./ProjectHistoryChart";
import { ChartView } from "../charts/ChartView";

/** The trend chart plots the raw history points as-is — a stable identity selector (defined at
 *  module scope, not inline) so ProjectHistoryChart's memoised series stays referentially stable. */
const selectPoints = (points: ProjectHistoryPoint[]): ProjectHistoryPoint[] => points;

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
      select={selectPoints}
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
        <ChartView
          type="area"
          height="100%"
          xKey="date"
          legend={false}
          yDomain={[0, 100]}
          valueFormatter={(v) => `${v}%`}
          data={points as unknown as { name: string }[]}
          series={[{ key: "completionRate", label: "Completion %" }]}
        />
      )}
    </ProjectHistoryChart>
  );
}
