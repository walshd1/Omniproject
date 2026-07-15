import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Panel } from "../../../lib/screen";
import { ChartView } from "../../charts/ChartView";
import type { ChartRow, ChartSeries } from "../../charts/primitives";

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
  const rows = (Array.isArray(c["rows"]) ? (c["rows"] as unknown[]) : []).filter((r) => r && typeof r === "object" && !Array.isArray(r)) as Array<Record<string, unknown>>;
  const chartType = (["bar", "line", "area", "pie"].includes(String(c["chartType"])) ? c["chartType"] : "bar") as ChartType;
  const { xKey, series } = resolveFields(rows, c);
  const stacked = c["stacked"] === true;
  const legend = c["legend"] !== false;

  const body = (() => {
    if (rows.length === 0 || series.length === 0) {
      return <p className="text-sm text-muted-foreground" data-testid="chart-empty">No data to chart yet.</p>;
    }
    if (chartType === "pie") {
      const key = series[0]!.key;
      const data = rows.map((r) => ({ name: String(r[xKey] ?? ""), value: num(r[key]) }));
      return <ChartView type="pie" data={data} legend={legend} />;
    }
    const data: ChartRow[] = rows.map((r) => {
      const row: ChartRow = { [xKey]: String(r[xKey] ?? "") };
      for (const s of series) row[s.key] = num(r[s.key]);
      return row;
    });
    if (chartType === "line") return <ChartView type="line" data={data} series={series} legend={legend} xKey={xKey} />;
    if (chartType === "area") return <ChartView type="area" data={data} series={series} stacked={stacked} legend={legend} xKey={xKey} />;
    return <ChartView type="bar" data={data} series={series} stacked={stacked} legend={legend} />;
  })();

  return (
    <Card>
      {panel.title && (
        <CardHeader className="pb-1">
          <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">{panel.title}</CardTitle>
        </CardHeader>
      )}
      <CardContent>{body}</CardContent>
    </Card>
  );
}
