import { useMemo } from "react";
import { BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { runCustomReport, runCustomReportTrend, metricLabel, type CustomReportDef, type Row } from "../../lib/custom-report";
import { truncateLabel } from "../../lib/utils";
import { chartTooltipStyle } from "./chart-theme";

/**
 * Generic renderer for a bespoke report definition — runs the definition over the supplied rows and
 * draws a grouped table, bar/area chart, pie (share), cross-tab (pivot) or month-bucketed trend
 * line. No bespoke component per report: a customer's definition renders here. Chart type + options
 * (stacked, legend) come from the definition's `viz`/`chart` — the chart editor. The rows are fetched
 * by the surrounding section (project issues or the portfolio fan-out).
 */

// Categorical palette — validated colorblind-safe (see the dataviz validator). Assigned in fixed
// order, never cycled for identity; the pie caps to these slots + a neutral "Other".
const PALETTE = ["#2563eb", "#16a34a", "#d97706", "#9333ea", "#dc2626", "#0891b2"];
const OTHER_COLOR = "#6b7280"; // neutral gray for the aggregated "Other" pie slice

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 }));

/** The `viz: "line"` path: a month-bucketed trend of the metrics, computed live over `rows`. */
function TrendReport({ def, rows }: { def: CustomReportDef; rows: readonly Row[] }) {
  const trend = useMemo(() => runCustomReportTrend(def, rows), [def, rows]);

  if (!def.dateField || trend.matched === 0) {
    return (
      <div className="bg-card border border-dashed border-border p-6 text-center text-sm text-muted-foreground" data-testid={`custom-report-empty-${def.id}`}>
        {def.dateField ? `No matching data for “${def.label}”.` : `“${def.label}” needs a date field to trend.`}
      </div>
    );
  }

  const chartData = trend.points.map((p) => {
    const row: Record<string, string | number> = { name: p.label };
    for (const m of def.metrics) row[m.id] = p.cells[m.id] ?? 0;
    return row;
  });

  const legendOn = def.chart?.legend !== false;
  const stacked = def.chart?.stacked === true;

  return (
    <div className="space-y-3" data-testid={`custom-report-${def.id}`}>
      <ResponsiveContainer width="100%" height={240}>
        {def.viz === "area" ? (
          <AreaChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(v as number)} />
            <Tooltip formatter={(v) => fmt(v as number)} contentStyle={chartTooltipStyle} />
            {legendOn && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {def.metrics.map((m, i) => (
              <Area key={m.id} type="monotone" dataKey={m.id} name={metricLabel(m)} {...(stacked ? { stackId: "1" } : {})} stroke={PALETTE[i % PALETTE.length]!} fill={PALETTE[i % PALETTE.length]!} fillOpacity={0.25} strokeWidth={2} />
            ))}
          </AreaChart>
        ) : (
          <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(v as number)} />
            <Tooltip formatter={(v) => fmt(v as number)} contentStyle={chartTooltipStyle} />
            {legendOn && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {def.metrics.map((m, i) => (
              <Line key={m.id} type="monotone" dataKey={m.id} name={metricLabel(m)} stroke={PALETTE[i % PALETTE.length]!} strokeWidth={2} dot={{ r: 3 }} />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
              <th className="py-1.5 pr-3 font-bold">Month</th>
              <th className="py-1.5 px-2 font-bold text-right">Items</th>
              {def.metrics.map((m) => <th key={m.id} className="py-1.5 px-2 font-bold text-right">{metricLabel(m)}</th>)}
            </tr>
          </thead>
          <tbody>
            {trend.points.map((p) => (
              <tr key={p.period} className="border-b border-border/50" data-testid={`custom-report-row-${def.id}-${p.period}`}>
                <td className="py-1.5 pr-3">{p.label}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{p.count}</td>
                {def.metrics.map((m) => <td key={m.id} className="py-1.5 px-2 text-right tabular-nums">{fmt(p.cells[m.id] ?? 0)}</td>)}
              </tr>
            ))}
            <tr className="border-t-2 border-foreground font-black">
              <td className="py-1.5 pr-3">Total</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{trend.matched}</td>
              {def.metrics.map((m) => <td key={m.id} className="py-1.5 px-2 text-right tabular-nums">{fmt(trend.grand[m.id] ?? 0)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CustomReport({ def, rows }: { def: CustomReportDef; rows: readonly Row[] }) {
  if (def.viz === "line" || def.viz === "area") return <TrendReport def={def} rows={rows} />;
  return <GroupedReport def={def} rows={rows} />;
}

/** The `viz: "table" | "bar"` path: single-level grouping (optionally a second level for a pivot). */
function GroupedReport({ def, rows }: { def: CustomReportDef; rows: readonly Row[] }) {
  const result = useMemo(() => runCustomReport(def, rows), [def, rows]);

  if (result.matched === 0) {
    return (
      <div className="bg-card border border-dashed border-border p-6 text-center text-sm text-muted-foreground" data-testid={`custom-report-empty-${def.id}`}>
        No matching data for “{def.label}”.
      </div>
    );
  }

  const chartData = result.groups.slice(0, 12).map((g) => {
    const row: Record<string, string | number> = { name: truncateLabel(g.label) };
    for (const m of def.metrics) row[m.id] = g.cells[m.id] ?? 0;
    return row;
  });

  // The pivot cell shows the FIRST metric only — a genuine two-level cross-tab, kept to one number
  // per cell so it stays readable; the ordinary table below still lists every metric per row-total.
  const pivotMetric = def.metrics[0];
  const legendOn = def.chart?.legend !== false;
  const stacked = def.chart?.stacked === true;

  // Pie = the share of the FIRST metric across groups. Cap to the palette's fixed slots (never cycle
  // categorical hues) with the remainder aggregated into a neutral "Other" slice.
  const pieData = useMemo(() => {
    if (!pivotMetric) return [] as { name: string; value: number }[];
    const sorted = result.groups.map((g) => ({ name: g.label, value: g.cells[pivotMetric.id] ?? 0 })).filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
    if (sorted.length <= PALETTE.length) return sorted;
    const top = sorted.slice(0, PALETTE.length - 1);
    const other = sorted.slice(PALETTE.length - 1).reduce((s, d) => s + d.value, 0);
    return other > 0 ? [...top, { name: "Other", value: other }] : top;
  }, [result, pivotMetric]);

  return (
    <div className="space-y-3" data-testid={`custom-report-${def.id}`}>
      {def.viz === "bar" && (
        <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 34)}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(v as number)} />
            <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v) => fmt(v as number)} contentStyle={chartTooltipStyle} />
            {legendOn && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {def.metrics.map((m, i) => <Bar key={m.id} dataKey={m.id} name={metricLabel(m)} {...(stacked ? { stackId: "1" } : {})} fill={PALETTE[i % PALETTE.length]!} radius={[0, 4, 4, 0]} />)}
          </BarChart>
        </ResponsiveContainer>
      )}

      {def.viz === "pie" && pivotMetric && pieData.length > 0 && (
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={92} label={(e: { name?: string; percent?: number }) => `${truncateLabel(e.name ?? "")} ${Math.round((e.percent ?? 0) * 100)}%`} labelLine={false}>
              {pieData.map((d, i) => <Cell key={d.name} fill={d.name === "Other" ? OTHER_COLOR : PALETTE[i % PALETTE.length]!} />)}
            </Pie>
            <Tooltip formatter={(v) => fmt(v as number)} contentStyle={chartTooltipStyle} />
            {legendOn && <Legend wrapperStyle={{ fontSize: 11 }} />}
          </PieChart>
        </ResponsiveContainer>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
              <th className="py-1.5 pr-3 font-bold">{def.groupBy || "All"}</th>
              <th className="py-1.5 px-2 font-bold text-right">Items</th>
              {def.metrics.map((m) => <th key={m.id} className="py-1.5 px-2 font-bold text-right">{metricLabel(m)}</th>)}
            </tr>
          </thead>
          <tbody>
            {result.groups.map((g) => (
              <tr key={g.key} className="border-b border-border/50" data-testid={`custom-report-row-${def.id}-${g.key}`}>
                <td className="py-1.5 pr-3 truncate max-w-[16rem]">{g.label}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{g.count}</td>
                {def.metrics.map((m) => <td key={m.id} className="py-1.5 px-2 text-right tabular-nums">{fmt(g.cells[m.id] ?? 0)}</td>)}
              </tr>
            ))}
            <tr className="border-t-2 border-foreground font-black">
              <td className="py-1.5 pr-3">Total</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{result.matched}</td>
              {def.metrics.map((m) => <td key={m.id} className="py-1.5 px-2 text-right tabular-nums">{fmt(result.grand[m.id] ?? 0)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>

      {result.columns && pivotMetric && (
        <div className="overflow-x-auto" data-testid={`custom-report-pivot-${def.id}`}>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
            Pivot — {def.groupBy} × {def.groupBy2} ({metricLabel(pivotMetric)})
          </p>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                <th className="py-1.5 pr-3 font-bold">{def.groupBy}</th>
                {result.columns.map((col) => <th key={col} className="py-1.5 px-2 font-bold text-right">{col}</th>)}
              </tr>
            </thead>
            <tbody>
              {result.groups.map((g) => (
                <tr key={g.key} className="border-b border-border/50" data-testid={`custom-report-pivot-row-${def.id}-${g.key}`}>
                  <td className="py-1.5 pr-3 truncate max-w-[16rem]">{g.label}</td>
                  {result.columns!.map((col) => (
                    <td key={col} className="py-1.5 px-2 text-right tabular-nums">{fmt(g.pivot?.[col]?.cells[pivotMetric.id] ?? 0)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
