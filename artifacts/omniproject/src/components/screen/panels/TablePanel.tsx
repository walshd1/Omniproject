import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Panel } from "../../../lib/screen";

/**
 * Table panel - a simple grid. Two accepted row shapes:
 *   - POSITIONAL: config { columns: string[], rows: (string|number)[][] } - cells line up with columns.
 *   - OBJECT-ROWS: config { rows: Record[], columns?: string[] } - the shape every rows/rollup endpoint
 *     emits ({ rows: [ {..} ] }). columns (field keys) is optional; when omitted the columns are derived
 *     from the union of the rows' keys, so a source-bound panel renders with zero config. This lets a panel
 *     bind straight to a rows endpoint (raw, or a groupBy/metric roll-up).
 * maxRows? windows large datasets (default 50); the rest sit behind a "show all" expander.
 */
const DEFAULT_MAX_ROWS = 50;

/** Normalise either row shape to positional `columns` + `rows` (array-of-arrays) for one render path. */
function normaliseTable(c: Record<string, unknown>): { columns: string[]; rows: unknown[][] } {
  const rawRows = Array.isArray(c["rows"]) ? (c["rows"] as unknown[]) : [];
  const configColumns = Array.isArray(c["columns"]) ? (c["columns"] as unknown[]).map(String) : null;
  const objectMode = rawRows.length > 0 && !Array.isArray(rawRows[0]) && typeof rawRows[0] === "object" && rawRows[0] !== null;
  if (!objectMode) {
    return { columns: configColumns ?? [], rows: rawRows.filter(Array.isArray) as unknown[][] };
  }
  const records = rawRows as Array<Record<string, unknown>>;
  const columns = configColumns ?? [...new Set(records.flatMap((r) => Object.keys(r)))];
  return { columns, rows: records.map((r) => columns.map((col) => r[col] ?? "")) };
}

export function TablePanel({ panel }: { panel: Panel }) {
  const c = panel.config ?? {};
  const { columns, rows } = normaliseTable(c);
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
