import { SeriesBarChart, SeriesLineChart, SeriesAreaChart, SharePieChart, ScatterPlotChart, TreemapChart, type ChartRow, type ChartSeries, type ScatterPoint, type TreeNode, type ReferenceMark, type ChartHeight } from "./primitives";
import { GanttChart, type GanttItem } from "./gantt";

/**
 * The ONE common chart renderer. A chart is a `{ type, data, …options }` spec rendered on top of the
 * shared primitives — the chart analogue of how the view engine renders a ViewDefinition and the
 * report engine renders a CustomReportDef. Every chart in the app (custom report charts, view charts,
 * and the built-in report charts) draws through this, so there is exactly one place chart type maps to
 * a primitive. Data is supplied already-shaped by the caller; ChartView never fetches or computes.
 */
export type ChartViewSpec =
  | { type: "bar"; data: ChartRow[]; series: ChartSeries[]; stacked?: boolean; legend?: boolean; orientation?: "horizontal" | "vertical"; height?: ChartHeight; referenceLines?: ReferenceMark[]; valueFormatter?: (n: number) => string }
  | { type: "line"; data: ChartRow[]; series: ChartSeries[]; legend?: boolean; height?: ChartHeight; xKey?: string; referenceLines?: ReferenceMark[]; valueFormatter?: (n: number) => string; yDomain?: [number, number] }
  | { type: "area"; data: ChartRow[]; series: ChartSeries[]; stacked?: boolean; legend?: boolean; height?: ChartHeight; xKey?: string; referenceLines?: ReferenceMark[]; valueFormatter?: (n: number) => string; yDomain?: [number, number] }
  | { type: "pie" | "donut"; data: { name: string; value: number }[]; legend?: boolean; height?: ChartHeight }
  | { type: "scatter"; points: ScatterPoint[]; xLabel?: string; yLabel?: string; height?: ChartHeight }
  | { type: "treemap"; data: TreeNode[]; height?: ChartHeight }
  | { type: "gantt"; items: GanttItem[]; height?: number };

export function ChartView(spec: ChartViewSpec) {
  switch (spec.type) {
    case "bar":
      return <SeriesBarChart data={spec.data} series={spec.series} stacked={spec.stacked ?? false} legend={spec.legend ?? true} orientation={spec.orientation ?? "horizontal"} {...(spec.height ? { height: spec.height } : {})} {...(spec.referenceLines ? { referenceLines: spec.referenceLines } : {})} {...(spec.valueFormatter ? { valueFormatter: spec.valueFormatter } : {})} />;
    case "line":
      return <SeriesLineChart data={spec.data} series={spec.series} legend={spec.legend ?? true} {...(spec.height ? { height: spec.height } : {})} {...(spec.xKey ? { xKey: spec.xKey } : {})} {...(spec.referenceLines ? { referenceLines: spec.referenceLines } : {})} {...(spec.valueFormatter ? { valueFormatter: spec.valueFormatter } : {})} {...(spec.yDomain ? { yDomain: spec.yDomain } : {})} />;
    case "area":
      return <SeriesAreaChart data={spec.data} series={spec.series} stacked={spec.stacked ?? false} legend={spec.legend ?? true} {...(spec.height ? { height: spec.height } : {})} {...(spec.xKey ? { xKey: spec.xKey } : {})} {...(spec.referenceLines ? { referenceLines: spec.referenceLines } : {})} {...(spec.valueFormatter ? { valueFormatter: spec.valueFormatter } : {})} {...(spec.yDomain ? { yDomain: spec.yDomain } : {})} />;
    case "pie":
    case "donut":
      return <SharePieChart data={spec.data} donut={spec.type === "donut"} legend={spec.legend ?? true} {...(spec.height ? { height: spec.height } : {})} />;
    case "scatter":
      return <ScatterPlotChart points={spec.points} {...(spec.xLabel ? { xLabel: spec.xLabel } : {})} {...(spec.yLabel ? { yLabel: spec.yLabel } : {})} {...(spec.height ? { height: spec.height } : {})} />;
    case "treemap":
      return <TreemapChart data={spec.data} {...(spec.height ? { height: spec.height } : {})} />;
    case "gantt":
      return <GanttChart items={spec.items} {...(spec.height ? { height: spec.height } : {})} />;
  }
}
