import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { runCustomReport, metricLabel, type CustomReportDef, type Row } from "../../lib/custom-report";
import { truncateLabel } from "../../lib/utils";

/**
 * Generic renderer for a bespoke report definition — runs the definition over the supplied rows and
 * draws a grouped table or bar chart. No bespoke component per report: a customer's definition renders
 * here. The rows are fetched by the surrounding section (project issues or the portfolio fan-out).
 */

const PALETTE = ["#2563eb", "#16a34a", "#d97706", "#9333ea", "#dc2626", "#0891b2"];

export function CustomReport({ def, rows }: { def: CustomReportDef; rows: readonly Row[] }) {
  const result = useMemo(() => runCustomReport(def, rows), [def, rows]);
  const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 }));

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

  return (
    <div className="space-y-3" data-testid={`custom-report-${def.id}`}>
      {def.viz === "bar" && (
        <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 34)}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(v as number)} />
            <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v) => fmt(v as number)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {def.metrics.map((m, i) => <Bar key={m.id} dataKey={m.id} name={metricLabel(m)} fill={PALETTE[i % PALETTE.length]} />)}
          </BarChart>
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
    </div>
  );
}
