import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Panel } from "../../../lib/screen";
import { ChartView } from "../../charts/ChartView";
import type { ChartRow, ChartSeries } from "../../charts/primitives";
import { resolveDrillTo } from "../../../lib/drill-to";
import type { DrillTo } from "@workspace/backend-catalogue";
import { PanelControls } from "../PanelControls";
import { applyControls, defaultControlsState, type ControlsConfig, type ControlsState } from "../../../lib/panel-controls";

/**
 * Chart panel — draws a bar / line / area / pie chart straight from OBJECT-ROWS (the `{ rows: [{...}] }`
 * shape every rows/rollup endpoint emits), through the shared ChartView renderer. It computes nothing: a
 * `source`-bound panel supplies already-rolled-up rows and this maps them onto the chart primitive.
 *
 * config:
 *   { chartType: "bar"|"line"|"area"|"pie" (default "bar"),
 *     rows: Record<string, unknown>[]        (usually merged in from `source`),
 *     xKey?: string                          (category field; default the first non-numeric key),
 *     series?: (string | { key: string; label?: string })[]  (value fields; default the numeric keys),
 *     stacked?: boolean, legend?: boolean }
 * A minimally-configured panel — just `chartType` + a bound `source` — renders by inferring x + series.
 */
type ChartType = "bar" | "line" | "area" | "pie";

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const isNumeric = (v: unknown): boolean => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)));

/** Resolve x (category) + series (value) fields from config or by inference over the rows' keys. */
function resolveFields(rows: Array<Record<string, unknown>>, c: Record<string, unknown>): { xKey: string; series: ChartSeries[] } {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const configXKey = typeof c["xKey"] === "string" ? (c["xKey"] as string) : null;
  const xKey = configXKey ?? keys.find((k) => rows.some((r) => !isNumeric(r[k]))) ?? keys[0] ?? "";
  const rawSeries = Array.isArray(c["series"]) ? (c["series"] as unknown[]) : null;
  const series: ChartSeries[] = rawSeries
    ? rawSeries.map((s) => (typeof s === "string" ? { key: s, label: s } : { key: String((s as { key: unknown }).key), label: String((s as { label?: unknown }).label ?? (s as { key: unknown }).key) }))
    : keys.filter((k) => k !== xKey && rows.some((r) => isNumeric(r[k]))).map((k) => ({ key: k, label: k }));
  return { xKey, series };
}

export function ChartPanel({ panel }: { panel: Panel }) {
  const c = panel.config ?? {};
  const rawRows = (Array.isArray(c["rows"]) ? (c["rows"] as unknown[]) : []).filter((r) => r && typeof r === "object" && !Array.isArray(r)) as Array<Record<string, unknown>>;
  const chartType = (["bar", "line", "area", "pie"].includes(String(c["chartType"])) ? c["chartType"] : "bar") as ChartType;

  // Optional controls: pivot the raw rows on the fly — the chosen group becomes x, the metric the series.
  const controls = (c["controls"] && typeof c["controls"] === "object" ? (c["controls"] as ControlsConfig) : null);
  const [ctrl, setCtrl] = useState<ControlsState | null>(() => (controls ? defaultControlsState(controls) : null));
  const ctrlResult = controls && ctrl ? applyControls(rawRows, controls, ctrl) : null;

  const rows = ctrlResult ? ctrlResult.rows : rawRows;
  const inferred = resolveFields(rows, c);
  const xKey = ctrlResult ? ctrlResult.groupByField : inferred.xKey;
  const series: ChartSeries[] = ctrlResult ? [{ key: ctrlResult.metricKey, label: ctrlResult.metricLabel }] : inferred.series;
  const stacked = c["stacked"] === true;
  const legend = c["legend"] !== false;
  const drillTo = (c["drillTo"] && typeof c["drillTo"] === "object" ? (c["drillTo"] as DrillTo) : null);
  const [, navigate] = useLocation();

  // Map a category label back to its SOURCE row so a click on that bar/slice can drill against the full row.
  const rowByCategory = new Map(rows.map((r) => [String(r[xKey] ?? ""), r]));
  const onDatum = drillTo
    ? (datum: { name?: string | number }) => {
        const src = rowByCategory.get(String(datum?.name ?? ""));
        const d = src ? resolveDrillTo(drillTo, src) : null;
        if (d) navigate(d.href);
      }
    : undefined;

  const body = (() => {
    if (rows.length === 0 || series.length === 0) {
      return <p className="text-sm text-muted-foreground" data-testid="chart-empty">No data to chart yet.</p>;
    }
    if (chartType === "pie") {
      const key = series[0]!.key;
      const data = rows.map((r) => ({ name: String(r[xKey] ?? ""), value: num(r[key]) }));
      return <ChartView type="pie" data={data} legend={legend} {...(onDatum ? { onDatumClick: onDatum } : {})} />;
    }
    if (chartType === "line" || chartType === "area") {
      const data: ChartRow[] = rows.map((r) => {
        const row: ChartRow = { [xKey]: String(r[xKey] ?? "") };
        for (const s of series) row[s.key] = num(r[s.key]);
        return row;
      });
      return chartType === "line"
        ? <ChartView type="line" data={data} series={series} legend={legend} xKey={xKey} />
        : <ChartView type="area" data={data} series={series} stacked={stacked} legend={legend} xKey={xKey} />;
    }
    // Bar: the shared bar primitive keys the category axis on `name`, so map the x field to `name`.
    const data: ChartRow[] = rows.map((r) => {
      const row: ChartRow = { name: String(r[xKey] ?? "") };
      for (const s of series) row[s.key] = num(r[s.key]);
      return row;
    });
    return <ChartView type="bar" data={data} series={series} stacked={stacked} legend={legend} {...(onDatum ? { onDatumClick: onDatum } : {})} />;
  })();

  return (
    <Card>
      {panel.title && (
        <CardHeader className="pb-1">
          <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">{panel.title}</CardTitle>
        </CardHeader>
      )}
      <CardContent>
        {controls && ctrl && <PanelControls config={controls} rows={rawRows} state={ctrl} onChange={setCtrl} />}
        {body}
      </CardContent>
    </Card>
  );
}
