import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Panel } from "../../../lib/screen";
import { resolveDrillTo } from "../../../lib/drill-to";
import type { DrillTo } from "@workspace/backend-catalogue";
import { PanelControls } from "../PanelControls";
import { PanelSavedViews } from "../PanelSavedViews";
import { applyControls, defaultControlsState, type ControlsConfig, type ControlsState } from "../../../lib/panel-controls";

/**
 * Table panel - a simple grid. Two accepted row shapes:
 *   - POSITIONAL: config { columns: string[], rows: (string|number)[][] } - cells line up with columns.
 *   - OBJECT-ROWS: config { rows: Record[], columns?: string[] } - the shape every rows/rollup endpoint
 *     emits ({ rows: [ {..} ] }). columns (field keys) is optional; when omitted the columns are derived
 *     from the union of the rows' keys, so a source-bound panel renders with zero config. This lets a panel
 *     bind straight to a rows endpoint (raw, or a groupBy/metric roll-up).
 * maxRows? windows large datasets (default 50); the rest sit behind a "show all" expander.
 * drillTo? a DrillTo descriptor (the SAME one reports use): a row click resolves it against that row and
 *   navigates to the pre-filtered work-item grid. Rows whose descriptor doesn't resolve stay non-clickable.
 */
const DEFAULT_MAX_ROWS = 50;

/** Normalise either row shape to positional columns/cells PLUS the per-display-row object (for drill). */
function normaliseTable(c: Record<string, unknown>): { columns: string[]; rows: unknown[][]; records: Array<Record<string, unknown>> } {
  const rawRows = Array.isArray(c["rows"]) ? (c["rows"] as unknown[]) : [];
  const configColumns = Array.isArray(c["columns"]) ? (c["columns"] as unknown[]).map(String) : null;
  const objectMode = rawRows.length > 0 && !Array.isArray(rawRows[0]) && typeof rawRows[0] === "object" && rawRows[0] !== null;
  if (!objectMode) {
    const cols = configColumns ?? [];
    const rows = rawRows.filter(Array.isArray) as unknown[][];
    // Build a per-row object from columns↔cells so a positional table can still drill.
    const records = rows.map((row) => Object.fromEntries(cols.map((col, i) => [col, row[i]])));
    return { columns: cols, rows, records };
  }
  const records = rawRows as Array<Record<string, unknown>>;
  const columns = configColumns ?? [...new Set(records.flatMap((r) => Object.keys(r)))];
  return { columns, rows: records.map((r) => columns.map((col) => r[col] ?? "")), records };
}

export function TablePanel({ panel }: { panel: Panel }) {
  const c = panel.config ?? {};
  const controls = (c["controls"] && typeof c["controls"] === "object" ? (c["controls"] as ControlsConfig) : null);
  const [ctrl, setCtrl] = useState<ControlsState | null>(() => (controls ? defaultControlsState(controls) : null));

  // With controls on, pivot the raw object rows on the fly; the group + metric become the table's columns.
  const rawObjectRows = (Array.isArray(c["rows"]) ? (c["rows"] as unknown[]) : []).filter((r) => r && typeof r === "object" && !Array.isArray(r)) as Array<Record<string, unknown>>;
  const ctrlResult = controls && ctrl ? applyControls(rawObjectRows, controls, ctrl) : null;
  const effectiveConfig: Record<string, unknown> = ctrlResult ? { ...c, rows: ctrlResult.rows, columns: [ctrlResult.groupByField, ctrlResult.metricKey] } : c;

  const { columns, rows, records } = normaliseTable(effectiveConfig);
  const maxRows = typeof c["maxRows"] === "number" && (c["maxRows"] as number) > 0 ? (c["maxRows"] as number) : DEFAULT_MAX_ROWS;
  const drillTo = (c["drillTo"] && typeof c["drillTo"] === "object" ? (c["drillTo"] as DrillTo) : null);
  const [, navigate] = useLocation();

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
        {controls && ctrl && typeof c["__screenId"] === "string" && (
          <PanelSavedViews screen={c["__screenId"] as string} panel={panel.id} state={ctrl} onApply={setCtrl} />
        )}
        {controls && ctrl && <PanelControls config={controls} rows={rawObjectRows} state={ctrl} onChange={setCtrl} />}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              {columns.map((col) => (
                <th key={col} className="py-1 pr-4 font-bold">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody data-testid="table-body">
            {shown.map((row, ri) => {
              const drill = drillTo ? resolveDrillTo(drillTo, records[ri] ?? {}) : null;
              return (
                // Keyboard-operable drill: a resolved row is focusable (tabIndex), announced (role) and
                // fired by Enter/Space as well as click — the props are written as literal JSX attributes
                // (not a conditional spread) so the interactive-parity guard can see the keyboard support.
                <tr
                  key={ri}
                  className={`border-b border-border/50 ${drill ? "cursor-pointer hover:bg-muted/50" : ""}`}
                  {...(drill && { "data-testid": `table-drill-${ri}`, title: drill.label })}
                  role={drill ? "button" : undefined}
                  tabIndex={drill ? 0 : undefined}
                  onClick={drill ? () => navigate(drill.href) : undefined}
                  onKeyDown={drill ? (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(drill.href); } } : undefined}
                >
                  {row.map((cell, ci) => (
                    <td key={ci} className="py-1 pr-4 tabular-nums">{String(cell)}</td>
                  ))}
                </tr>
              );
            })}
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
