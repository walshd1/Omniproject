import { useMemo } from "react";
import { runCustomReport, runCustomReportTrend, metricLabel, type CustomReportDef, type Row } from "../../lib/custom-report";
import { ChartView } from "../charts/ChartView";
import { formatChartNumber, type ChartRow, type ChartSeries } from "../charts/primitives";

/**
 * Generic renderer for a bespoke report definition — runs the definition over the supplied rows and
 * draws a grouped table, bar/area chart, pie (share), cross-tab (pivot) or month-bucketed trend
 * line. The charts themselves are the shared, data-agnostic primitives (components/charts) — this
 * file just turns a report definition + its aggregated result into their `series` + `data`. The rows
 * are fetched by the surrounding section (project issues or the portfolio fan-out).
 */

const fmt = formatChartNumber;

/** The metrics of a report as chart series (id → label). */
const seriesOf = (def: CustomReportDef): ChartSeries[] => def.metrics.map((m) => ({ key: m.id, label: metricLabel(m) }));

/** The `viz: "line" | "area"` path: a month-bucketed trend of the metrics, computed live over `rows`. */
function TrendReport({ def, rows }: { def: CustomReportDef; rows: readonly Row[] }) {
  const trend = useMemo(() => runCustomReportTrend(def, rows), [def, rows]);

  if (!def.dateField || trend.matched === 0) {
    return (
      <div className="bg-card border border-dashed border-border p-6 text-center text-sm text-muted-foreground" data-testid={`custom-report-empty-${def.id}`}>
        {def.dateField ? `No matching data for “${def.label}”.` : `“${def.label}” needs a date field to trend.`}
      </div>
    );
  }

  const chartData: ChartRow[] = trend.points.map((p) => {
    const row: ChartRow = { name: p.label };
    for (const m of def.metrics) row[m.id] = p.cells[m.id] ?? 0;
    return row;
  });
  const legend = def.chart?.legend !== false;
  const stacked = def.chart?.stacked === true;

  return (
    <div className="space-y-3" data-testid={`custom-report-${def.id}`}>
      {def.viz === "area"
        ? <ChartView type="area" data={chartData} series={seriesOf(def)} stacked={stacked} legend={legend} />
        : <ChartView type="line" data={chartData} series={seriesOf(def)} legend={legend} />}

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

/** The `viz: "table" | "bar" | "pie"` path: single-level grouping (optionally a second level for a pivot). */
function GroupedReport({ def, rows }: { def: CustomReportDef; rows: readonly Row[] }) {
  const result = useMemo(() => runCustomReport(def, rows), [def, rows]);

  if (result.matched === 0) {
    return (
      <div className="bg-card border border-dashed border-border p-6 text-center text-sm text-muted-foreground" data-testid={`custom-report-empty-${def.id}`}>
        No matching data for “{def.label}”.
      </div>
    );
  }

  const chartData: ChartRow[] = result.groups.slice(0, 12).map((g) => {
    const row: ChartRow = { name: g.label };
    for (const m of def.metrics) row[m.id] = g.cells[m.id] ?? 0;
    return row;
  });

  // The pivot cell shows the FIRST metric only — a genuine two-level cross-tab, kept to one number
  // per cell so it stays readable; the ordinary table below still lists every metric per row-total.
  const pivotMetric = def.metrics[0];
  const legend = def.chart?.legend !== false;
  const stacked = def.chart?.stacked === true;
  // Pie shows the share of the FIRST metric across groups; the primitive caps to its palette + Other.
  const pieData = pivotMetric ? result.groups.map((g) => ({ name: g.label, value: g.cells[pivotMetric.id] ?? 0 })) : [];

  return (
    <div className="space-y-3" data-testid={`custom-report-${def.id}`}>
      {def.viz === "bar" && <ChartView type="bar" data={chartData} series={seriesOf(def)} stacked={stacked} legend={legend} />}
      {def.viz === "pie" && pivotMetric && <ChartView type="pie" data={pieData} legend={legend} />}

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
