import { SeriesBarChart, SeriesLineChart, SeriesAreaChart, SharePieChart, ScatterPlotChart, TreemapChart, type ChartRow, type ChartSeries, type ScatterPoint, type TreeNode, type ReferenceMark, type ChartHeight } from "./primitives";
import { GanttChart, type GanttItem } from "./gantt";
import { ArtifactFrame } from "../artifact/ArtifactFrame";
import type { StyleSpec } from "../../lib/artifact-style";

/**
 * The ONE common chart renderer. A chart is a `{ type, data, …options }` spec rendered on top of the
 * shared primitives — the chart analogue of how the view engine renders a ViewDefinition and the
 * report engine renders a CustomReportDef. Every chart in the app (custom report charts, view charts,
 * and the built-in report charts) draws through this, so there is exactly one place chart type maps to
 * a primitive. Data is supplied already-shaped by the caller; ChartView never fetches or computes.
 */
export type ChartViewSpec =
  | { type: "bar"; data: ChartRow[]; series: ChartSeries[]; stacked?: boolean; legend?: boolean; orientation?: "horizontal" | "vertical"; height?: ChartHeight; referenceLines?: ReferenceMark[]; valueFormatter?: (n: number) => string; palette?: string[]; onDatumClick?: (row: ChartRow) => void }
  | { type: "line"; data: ChartRow[]; series: ChartSeries[]; legend?: boolean; height?: ChartHeight; xKey?: string; referenceLines?: ReferenceMark[]; valueFormatter?: (n: number) => string; yDomain?: [number, number]; palette?: string[] }
  | { type: "area"; data: ChartRow[]; series: ChartSeries[]; stacked?: boolean; legend?: boolean; height?: ChartHeight; xKey?: string; referenceLines?: ReferenceMark[]; valueFormatter?: (n: number) => string; yDomain?: [number, number]; palette?: string[] }
  | { type: "pie" | "donut"; data: { name: string; value: number }[]; legend?: boolean; height?: ChartHeight; palette?: string[]; onDatumClick?: (row: { name: string; value: number }) => void }
  | { type: "scatter"; points: ScatterPoint[]; xLabel?: string; yLabel?: string; height?: ChartHeight }
  | { type: "treemap"; data: TreeNode[]; height?: ChartHeight }
  | { type: "gantt"; items: GanttItem[]; height?: number; palette?: string[] };

/**
 * A ChartViewSpec plus an optional artifact StyleSpec. The user's title/font/colours/background are
 * applied by wrapping the drawn chart in an ArtifactFrame — so the same theming reaches a built-in and a
 * bespoke chart identically, without any primitive needing to know about styling.
 */
export function ChartView(spec: ChartViewSpec & { style?: StyleSpec }) {
  const chart = renderChart(spec);
  return spec.style ? <ArtifactFrame style={spec.style}>{chart}</ArtifactFrame> : chart;
}

function renderChart(spec: ChartViewSpec) {
  switch (spec.type) {
    case "bar":
      return <SeriesBarChart data={spec.data} series={spec.series} stacked={spec.stacked ?? false} legend={spec.legend ?? true} orientation={spec.orientation ?? "horizontal"} {...(spec.height ? { height: spec.height } : {})} {...(spec.referenceLines ? { referenceLines: spec.referenceLines } : {})} {...(spec.valueFormatter ? { valueFormatter: spec.valueFormatter } : {})} {...(spec.palette ? { palette: spec.palette } : {})} {...(spec.onDatumClick ? { onDatumClick: spec.onDatumClick } : {})} />;
    case "line":
      return <SeriesLineChart data={spec.data} series={spec.series} legend={spec.legend ?? true} {...(spec.height ? { height: spec.height } : {})} {...(spec.xKey ? { xKey: spec.xKey } : {})} {...(spec.referenceLines ? { referenceLines: spec.referenceLines } : {})} {...(spec.valueFormatter ? { valueFormatter: spec.valueFormatter } : {})} {...(spec.yDomain ? { yDomain: spec.yDomain } : {})} {...(spec.palette ? { palette: spec.palette } : {})} />;
    case "area":
      return <SeriesAreaChart data={spec.data} series={spec.series} stacked={spec.stacked ?? false} legend={spec.legend ?? true} {...(spec.height ? { height: spec.height } : {})} {...(spec.xKey ? { xKey: spec.xKey } : {})} {...(spec.referenceLines ? { referenceLines: spec.referenceLines } : {})} {...(spec.valueFormatter ? { valueFormatter: spec.valueFormatter } : {})} {...(spec.yDomain ? { yDomain: spec.yDomain } : {})} {...(spec.palette ? { palette: spec.palette } : {})} />;
    case "pie":
    case "donut":
      return <SharePieChart data={spec.data} donut={spec.type === "donut"} legend={spec.legend ?? true} {...(spec.height ? { height: spec.height } : {})} {...(spec.palette ? { palette: spec.palette } : {})} {...(spec.onDatumClick ? { onDatumClick: spec.onDatumClick } : {})} />;
    case "scatter":
      return <ScatterPlotChart points={spec.points} {...(spec.xLabel ? { xLabel: spec.xLabel } : {})} {...(spec.yLabel ? { yLabel: spec.yLabel } : {})} {...(spec.height ? { height: spec.height } : {})} />;
    case "treemap":
      return <TreemapChart data={spec.data} {...(spec.height ? { height: spec.height } : {})} />;
    case "gantt":
      return <GanttChart items={spec.items} {...(spec.height ? { height: spec.height } : {})} {...(spec.palette ? { palette: spec.palette } : {})} />;
  }
}
