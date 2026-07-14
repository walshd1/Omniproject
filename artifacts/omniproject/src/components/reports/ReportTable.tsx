import { type ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * The ONE tabular primitive for the report panels. Every built-in report hand-rolled the same
 * `<div class="overflow-x-auto"><table><thead>…</thead><tbody>{rows.map(…)}</tbody></table></div>`
 * skeleton — identical wrapper, identical header row styling, identical row striping and testid
 * wiring — differing only in which columns exist and how each cell renders. This captures the
 * skeleton; each report supplies a `columns` config and its rows. STATELESS/pure: it renders what
 * it's given, computes nothing, fetches nothing.
 *
 * A column owns its own cell rendering (`cell`), so JSX cells (chips, badges, nested drivers),
 * conditional colouring (`cellClassName` as a function), right-alignment for numbers and per-cell
 * testids all still work — the primitive just stops the boilerplate being re-typed per report.
 */

/** One column: a header plus how to render (and align/style/testid) its cell for a row of type T. */
export interface ReportColumn<T> {
  /** Header label (or any node). */
  header: ReactNode;
  /** Render this column's cell for a row. */
  cell: (row: T) => ReactNode;
  /** Right-align (the convention for numeric columns; adds `tabular-nums`). Default left. */
  align?: "left" | "right";
  /** Extra `<td>` classes — a string, or a function of the row for conditional colouring. */
  cellClassName?: string | ((row: T) => string);
  /** Extra `<th>` classes for this column. */
  headerClassName?: string;
  /** Optional per-cell test id (e.g. a drill-in target within a row). */
  testId?: (row: T) => string;
}

export function ReportTable<T>({
  columns, rows, rowKey, rowTestId, size = "compact", rowClassName,
}: {
  columns: ReportColumn<T>[];
  rows: T[];
  /** Stable React key per row. */
  rowKey: (row: T) => string | number;
  /** Optional `data-testid` per row (the report's row-addressing convention). */
  rowTestId?: (row: T) => string;
  /** "compact" (text-xs, tight padding) — the money/detail tables; "comfortable" (text-sm, roomier,
   *  top-aligned) — the people/health tables with multi-line cells. */
  size?: "compact" | "comfortable";
  /** Extra classes applied to every body `<tr>` (e.g. when a report needs a shared row modifier). */
  rowClassName?: string;
}) {
  const compact = size === "compact";
  const cellPad = compact ? "py-1.5" : "py-2";
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse", compact ? "text-xs" : "text-sm")}>
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
            {columns.map((c, i) => (
              <th key={i} className={cn(cellPad, i === 0 ? "pr-3" : "px-2", "font-bold", c.align === "right" && "text-right", c.headerClassName)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={cn("border-b border-border/50", !compact && "align-top", rowClassName)}
              {...(rowTestId ? { "data-testid": rowTestId(row) } : {})}
            >
              {columns.map((c, i) => {
                const extra = typeof c.cellClassName === "function" ? c.cellClassName(row) : c.cellClassName;
                return (
                  <td
                    key={i}
                    className={cn(cellPad, i === 0 ? "pr-3" : "px-2", c.align === "right" && "text-right tabular-nums", extra)}
                    {...(c.testId ? { "data-testid": c.testId(row) } : {})}
                  >
                    {c.cell(row)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
