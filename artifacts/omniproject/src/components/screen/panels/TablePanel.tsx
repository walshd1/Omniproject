import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Panel } from "../../../lib/screen";

/**
 * Table panel — a simple grid. config: { columns: string[], rows: (string|number)[][],
 * maxRows?: number }.
 *
 * WINDOWED: only the first `maxRows` (default 50) rows are rendered; the rest are
 * behind a "show all" expander, so a large dataset doesn't paint thousands of DOM
 * nodes up front (the cheapest, most reliable rendering win for big tables).
 */
const DEFAULT_MAX_ROWS = 50;

export function TablePanel({ panel }: { panel: Panel }) {
  const c = panel.config ?? {};
  const columns = Array.isArray(c["columns"]) ? (c["columns"] as unknown[]).map(String) : [];
  const rows = Array.isArray(c["rows"]) ? (c["rows"] as unknown[][]) : [];
  const maxRows = typeof c["maxRows"] === "number" && (c["maxRows"] as number) > 0 ? (c["maxRows"] as number) : DEFAULT_MAX_ROWS;

  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, maxRows);
  const hidden = rows.length - shown.length;

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
          <tbody data-testid="table-body">
            {shown.map((row, ri) => (
              <tr key={ri} className="border-b border-border/50">
                {row.map((cell, ci) => (
                  <td key={ci} className="py-1 pr-4 tabular-nums">{String(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            data-testid="table-show-all"
            className="mt-2 text-xs text-muted-foreground underline hover:text-foreground"
          >
            Show all {rows.length} rows ({hidden} more)
          </button>
        )}
      </CardContent>
    </Card>
  );
}
