import { BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, ScatterChart, Scatter, Treemap, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from "recharts";
import { gridTheme, axisTheme, chartTooltipStyle } from "../reports/chart-theme";
import { truncateLabel } from "../../lib/utils";

/** A horizontal annotation line at a y-value (e.g. a mean, a target, an ideal line). Recessive by
 *  default (dashed, muted); pass a `color` to emphasise. */
export interface ReferenceMark {
  value: number;
  label?: string;
  color?: string;
}
function renderReferenceLines(marks: ReferenceMark[] | undefined) {
  return (marks ?? []).map((m, i) => (
    <ReferenceLine key={i} y={m.value} stroke={m.color ?? "currentColor"} strokeDasharray="5 4"
      {...(m.color ? {} : { className: "text-muted-foreground" })}
      {...(m.label ? { label: { value: m.label, fontSize: 10, position: "right" as const } } : {})} />
  ));
}

/**
 * Data-agnostic chart primitives — reusable Recharts wrappers that take plain `series` + `data`, so
 * ANY data source can render a bar/line/area/pie without touching the report engine. Each applies the
 * shared theme, the validated colourblind-safe palette (assigned in fixed order, never cycled for
 * identity), a legend (default on) and a tooltip. The report generator is just one caller.
 */

// Categorical palette — validated colourblind-safe in light + dark (see the dataviz validator).
export const CHART_PALETTE = ["#2563eb", "#16a34a", "#d97706", "#9333ea", "#dc2626", "#0891b2"];
const OTHER_COLOR = "#6b7280"; // neutral gray for an aggregated "Other" slice

/** A chart height — pixels or a `"NN%"` of the parent (for cards that own their height). */
export type ChartHeight = number | `${number}%`;

/** Compact number format shared by every primitive's axes/tooltips. */
export const formatChartNumber = (n: number): string =>
  Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** One plotted measure. `key` indexes into each row; `label` names it in the legend/tooltip. */
export interface ChartSeries {
  key: string;
  label: string;
}
/** One row of chart data: a category/point key (default "name", or the chart's `xKey`) plus a
 *  numeric value per series key. */
export type ChartRow = Record<string, string | number>;

const color = (i: number, palette: string[] = CHART_PALETTE) => palette[i % palette.length]!;

/** Grouped or stacked bars. Horizontal (category axis on the left) by default; `orientation:
 *  "vertical"` draws upright columns. Bars get rounded data-ends per the mark spec. */
export function SeriesBarChart({ data, series, stacked = false, legend = true, orientation = "horizontal", height, referenceLines, valueFormatter = formatChartNumber, palette = CHART_PALETTE }: {
  data: ChartRow[];
  series: ChartSeries[];
  stacked?: boolean;
  legend?: boolean;
  orientation?: "horizontal" | "vertical";
  height?: ChartHeight;
  referenceLines?: ReferenceMark[];
  /** Format the measure axis + tooltip values (e.g. as currency). Defaults to a compact number. */
  valueFormatter?: (n: number) => string;
  /** Categorical colours (recolourable); defaults to the validated CHART_PALETTE. */
  palette?: string[];
}) {
  const horizontal = orientation === "horizontal";
  const h = height ?? (horizontal ? Math.max(180, data.length * 34) : 260);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid {...gridTheme} />
        {horizontal ? (
          <>
            <XAxis type="number" {...axisTheme} tick={{ fontSize: 11 }} tickFormatter={(v) => valueFormatter(v as number)} />
            <YAxis type="category" dataKey="name" {...axisTheme} width={150} tick={{ fontSize: 10 }} />
          </>
        ) : (
          <>
            <XAxis type="category" dataKey="name" {...axisTheme} tick={{ fontSize: 10 }} />
            <YAxis type="number" {...axisTheme} tick={{ fontSize: 11 }} tickFormatter={(v) => valueFormatter(v as number)} />
          </>
        )}
        <Tooltip formatter={(v) => valueFormatter(v as number)} contentStyle={chartTooltipStyle} />
        {legend && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {renderReferenceLines(referenceLines)}
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} {...(stacked ? { stackId: "1" } : {})} fill={color(i, palette)} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** A multi-series line chart (e.g. a time trend). `xKey` names the category field (default "name"). */
export function SeriesLineChart({ data, series, legend = true, height = 240, xKey = "name", referenceLines, valueFormatter = formatChartNumber, yDomain, palette = CHART_PALETTE }: {
  data: ChartRow[];
  series: ChartSeries[];
  legend?: boolean;
  height?: ChartHeight;
  xKey?: string;
  referenceLines?: ReferenceMark[];
  valueFormatter?: (n: number) => string;
  yDomain?: [number, number];
  palette?: string[];
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid {...gridTheme} />
        <XAxis dataKey={xKey} {...axisTheme} tick={{ fontSize: 11 }} />
        <YAxis {...axisTheme} tick={{ fontSize: 11 }} tickFormatter={(v) => valueFormatter(v as number)} {...(yDomain ? { domain: yDomain } : {})} />
        <Tooltip formatter={(v) => valueFormatter(v as number)} contentStyle={chartTooltipStyle} />
        {legend && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {renderReferenceLines(referenceLines)}
        {series.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={color(i, palette)} strokeWidth={2} dot={{ r: 3 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** A multi-series area chart, optionally stacked. `xKey` names the category field (default "name"). */
export function SeriesAreaChart({ data, series, stacked = false, legend = true, height = 240, xKey = "name", referenceLines, valueFormatter = formatChartNumber, yDomain, palette = CHART_PALETTE }: {
  data: ChartRow[];
  series: ChartSeries[];
  stacked?: boolean;
  legend?: boolean;
  height?: ChartHeight;
  xKey?: string;
  referenceLines?: ReferenceMark[];
  valueFormatter?: (n: number) => string;
  yDomain?: [number, number];
  palette?: string[];
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid {...gridTheme} />
        <XAxis dataKey={xKey} {...axisTheme} tick={{ fontSize: 11 }} />
        <YAxis {...axisTheme} tick={{ fontSize: 11 }} tickFormatter={(v) => valueFormatter(v as number)} {...(yDomain ? { domain: yDomain } : {})} />
        <Tooltip formatter={(v) => valueFormatter(v as number)} contentStyle={chartTooltipStyle} />
        {legend && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {renderReferenceLines(referenceLines)}
        {series.map((s, i) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} {...(stacked ? { stackId: "1" } : {})} stroke={color(i, palette)} fill={color(i, palette)} fillOpacity={0.25} strokeWidth={2} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** A part-to-whole pie. Caps to the palette's fixed slots (never cycling categorical hues) with the
 *  remainder aggregated into a neutral "Other" slice, and direct % labels so identity isn't
 *  colour-alone. Takes any `{ name, value }[]`. */
export function SharePieChart({ data, legend = true, height = 260, maxSlices = CHART_PALETTE.length, donut = false, palette = CHART_PALETTE }: {
  data: { name: string; value: number }[];
  legend?: boolean;
  height?: ChartHeight;
  maxSlices?: number;
  /** Render as a donut (a hole in the middle) rather than a solid pie. */
  donut?: boolean;
  palette?: string[];
}) {
  const sorted = data.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const slices = sorted.length <= maxSlices
    ? sorted
    : (() => {
        const top = sorted.slice(0, maxSlices - 1);
        const other = sorted.slice(maxSlices - 1).reduce((s, d) => s + d.value, 0);
        return other > 0 ? [...top, { name: "Other", value: other }] : top;
      })();
  if (slices.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={slices} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={92} innerRadius={donut ? 52 : 0} labelLine={false}
          label={(e: { name?: string; percent?: number }) => `${truncateLabel(e.name ?? "")} ${Math.round((e.percent ?? 0) * 100)}%`}>
          {slices.map((d, i) => <Cell key={d.name} fill={d.name === "Other" ? OTHER_COLOR : color(i, palette)} />)}
        </Pie>
        <Tooltip formatter={(v) => formatChartNumber(v as number)} contentStyle={chartTooltipStyle} />
        {legend && <Legend wrapperStyle={{ fontSize: 11 }} />}
      </PieChart>
    </ResponsiveContainer>
  );
}

/** A scatter plot of x/y points — e.g. effort vs. value, or two metrics against each other. */
export interface ScatterPoint {
  x: number;
  y: number;
  name?: string;
}
export function ScatterPlotChart({ points, xLabel, yLabel, height = 280 }: {
  points: ScatterPoint[];
  xLabel?: string;
  yLabel?: string;
  height?: ChartHeight;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
        <CartesianGrid {...gridTheme} />
        <XAxis type="number" dataKey="x" {...(xLabel ? { name: xLabel } : {})} {...axisTheme} tick={{ fontSize: 11 }} tickFormatter={(v) => formatChartNumber(v as number)} {...(xLabel ? { label: { value: xLabel, position: "bottom", fontSize: 11 } } : {})} />
        <YAxis type="number" dataKey="y" {...(yLabel ? { name: yLabel } : {})} {...axisTheme} tick={{ fontSize: 11 }} tickFormatter={(v) => formatChartNumber(v as number)} />
        <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={(v) => formatChartNumber(v as number)} contentStyle={chartTooltipStyle} />
        <Scatter data={points} fill={color(0)} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

/** A node in a work-breakdown / treemap hierarchy: a leaf carries a `value`; a branch carries
 *  `children` (its size is the sum of its leaves). */
export interface TreeNode {
  name: string;
  value?: number;
  children?: TreeNode[];
  /** Recharts' Treemap indexes data by string key; this keeps TreeNode assignable to its data type. */
  [key: string]: unknown;
}
interface TreemapCellProps {
  x?: number; y?: number; width?: number; height?: number; index?: number; depth?: number; name?: string;
}
/** Treemap cell — top-level branches take a palette colour; deeper cells are transparent with a
 *  surface-coloured gap so the hierarchy reads. Labels show when the cell is big enough. */
function TreemapCell({ x = 0, y = 0, width = 0, height = 0, index = 0, depth = 0, name = "" }: TreemapCellProps) {
  const fill = depth === 1 ? color(index) : "transparent";
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke="hsl(var(--card))" strokeWidth={2} />
      {depth === 1 && width > 56 && height > 18 && (
        <text x={x + 6} y={y + 16} fontSize={11} fill="#ffffff" className="pointer-events-none">{truncateLabel(name, 18)}</text>
      )}
    </g>
  );
}
/** A work-breakdown structure as a treemap — area ∝ value, nested by `children`. */
export function TreemapChart({ data, height = 280 }: { data: TreeNode[]; height?: ChartHeight }) {
  if (data.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <Treemap data={data} dataKey="value" nameKey="name" content={<TreemapCell />} isAnimationActive={false}>
        <Tooltip formatter={(v) => formatChartNumber(v as number)} contentStyle={chartTooltipStyle} />
      </Treemap>
    </ResponsiveContainer>
  );
}
