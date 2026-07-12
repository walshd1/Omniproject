import { BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { gridTheme, axisTheme, chartTooltipStyle } from "../reports/chart-theme";
import { truncateLabel } from "../../lib/utils";

/**
 * Data-agnostic chart primitives — reusable Recharts wrappers that take plain `series` + `data`, so
 * ANY data source can render a bar/line/area/pie without touching the report engine. Each applies the
 * shared theme, the validated colourblind-safe palette (assigned in fixed order, never cycled for
 * identity), a legend (default on) and a tooltip. The report generator is just one caller.
 */

// Categorical palette — validated colourblind-safe in light + dark (see the dataviz validator).
export const CHART_PALETTE = ["#2563eb", "#16a34a", "#d97706", "#9333ea", "#dc2626", "#0891b2"];
const OTHER_COLOR = "#6b7280"; // neutral gray for an aggregated "Other" slice

/** Compact number format shared by every primitive's axes/tooltips. */
export const formatChartNumber = (n: number): string =>
  Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** One plotted measure. `key` indexes into each row; `label` names it in the legend/tooltip. */
export interface ChartSeries {
  key: string;
  label: string;
}
/** One row of chart data: a category/point `name` plus a numeric value per series key. */
export type ChartRow = { name: string } & Record<string, string | number>;

const color = (i: number) => CHART_PALETTE[i % CHART_PALETTE.length]!;

/** Grouped or stacked bars. Horizontal (category axis on the left) by default; `orientation:
 *  "vertical"` draws upright columns. Bars get rounded data-ends per the mark spec. */
export function SeriesBarChart({ data, series, stacked = false, legend = true, orientation = "horizontal", height }: {
  data: ChartRow[];
  series: ChartSeries[];
  stacked?: boolean;
  legend?: boolean;
  orientation?: "horizontal" | "vertical";
  height?: number;
}) {
  const horizontal = orientation === "horizontal";
  const h = height ?? (horizontal ? Math.max(180, data.length * 34) : 260);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid {...gridTheme} />
        {horizontal ? (
          <>
            <XAxis type="number" {...axisTheme} tick={{ fontSize: 11 }} tickFormatter={(v) => formatChartNumber(v as number)} />
            <YAxis type="category" dataKey="name" {...axisTheme} width={150} tick={{ fontSize: 10 }} />
          </>
        ) : (
          <>
            <XAxis type="category" dataKey="name" {...axisTheme} tick={{ fontSize: 10 }} />
            <YAxis type="number" {...axisTheme} tick={{ fontSize: 11 }} tickFormatter={(v) => formatChartNumber(v as number)} />
          </>
        )}
        <Tooltip formatter={(v) => formatChartNumber(v as number)} contentStyle={chartTooltipStyle} />
        {legend && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} {...(stacked ? { stackId: "1" } : {})} fill={color(i)} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** A multi-series line chart (e.g. a time trend). */
export function SeriesLineChart({ data, series, legend = true, height = 240 }: {
  data: ChartRow[];
  series: ChartSeries[];
  legend?: boolean;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid {...gridTheme} />
        <XAxis dataKey="name" {...axisTheme} tick={{ fontSize: 11 }} />
        <YAxis {...axisTheme} tick={{ fontSize: 11 }} tickFormatter={(v) => formatChartNumber(v as number)} />
        <Tooltip formatter={(v) => formatChartNumber(v as number)} contentStyle={chartTooltipStyle} />
        {legend && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {series.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={color(i)} strokeWidth={2} dot={{ r: 3 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** A multi-series area chart, optionally stacked. */
export function SeriesAreaChart({ data, series, stacked = false, legend = true, height = 240 }: {
  data: ChartRow[];
  series: ChartSeries[];
  stacked?: boolean;
  legend?: boolean;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid {...gridTheme} />
        <XAxis dataKey="name" {...axisTheme} tick={{ fontSize: 11 }} />
        <YAxis {...axisTheme} tick={{ fontSize: 11 }} tickFormatter={(v) => formatChartNumber(v as number)} />
        <Tooltip formatter={(v) => formatChartNumber(v as number)} contentStyle={chartTooltipStyle} />
        {legend && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {series.map((s, i) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} {...(stacked ? { stackId: "1" } : {})} stroke={color(i)} fill={color(i)} fillOpacity={0.25} strokeWidth={2} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** A part-to-whole pie. Caps to the palette's fixed slots (never cycling categorical hues) with the
 *  remainder aggregated into a neutral "Other" slice, and direct % labels so identity isn't
 *  colour-alone. Takes any `{ name, value }[]`. */
export function SharePieChart({ data, legend = true, height = 260, maxSlices = CHART_PALETTE.length }: {
  data: { name: string; value: number }[];
  legend?: boolean;
  height?: number;
  maxSlices?: number;
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
        <Pie data={slices} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={92} labelLine={false}
          label={(e: { name?: string; percent?: number }) => `${truncateLabel(e.name ?? "")} ${Math.round((e.percent ?? 0) * 100)}%`}>
          {slices.map((d, i) => <Cell key={d.name} fill={d.name === "Other" ? OTHER_COLOR : color(i)} />)}
        </Pie>
        <Tooltip formatter={(v) => formatChartNumber(v as number)} contentStyle={chartTooltipStyle} />
        {legend && <Legend wrapperStyle={{ fontSize: 11 }} />}
      </PieChart>
    </ResponsiveContainer>
  );
}
