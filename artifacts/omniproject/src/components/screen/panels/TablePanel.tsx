import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Panel } from "../../../lib/screen";

/**
 * Table panel — a simple grid. config: { columns: string[], rows: (string|number)[][] }.
 */
export function TablePanel({ panel }: { panel: Panel }) {
  const c = panel.config ?? {};
  const columns = Array.isArray(c["columns"]) ? (c["columns"] as unknown[]).map(String) : [];
  const rows = Array.isArray(c["rows"]) ? (c["rows"] as unknown[][]) : [];
  return (
    <Card>
      {panel.title && (
        <CardHeader className="pb-1">
          <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">{panel.title}</CardTitle>
        </CardHeader>
      )}
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              {columns.map((col) => (
                <th key={col} className="py-1 pr-4 font-bold">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="border-b border-border/50">
                {row.map((cell, ci) => (
                  <td key={ci} className="py-1 pr-4 tabular-nums">{String(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
