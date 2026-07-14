import { type ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * The shared chrome for an editable admin row-table: the dense `p-1` grid, an auto-appended remove-×
 * column, the "no rows yet" empty-state row (with the correct colSpan), and per-row highlight hook.
 * Every draft-based *Admin editor (custom fields, closed projects, GUID relinks, identity map, …)
 * hand-rolled this identical chrome, differing only in which input each column renders. The parent
 * still owns the draft state, validation (via `rowClassName`), the Add button and Save/Reset toolbar —
 * this only removes the repeated table scaffolding. Presentational: no state of its own.
 */

/** One editable column: a header plus how to render its input cell for a row at an index. */
export interface EditableColumn<T> {
  header: string;
  /** Render the cell's control (an Input/select wired to the parent's `set(i, …)`). */
  cell: (row: T, index: number) => ReactNode;
}

export function EditableRowTable<T>({
  columns, rows, rowKey, rowTestId, rowClassName, onRemove, removeLabel, emptyText,
}: {
  columns: EditableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  /** `data-testid` per row (the editor's row-addressing convention, usually `x-row-${i}`). */
  rowTestId?: (row: T, index: number) => string;
  /** Per-row classes — e.g. `badRows.has(i) ? "bg-red-500/10" : ""` to flag invalid rows. */
  rowClassName?: (row: T, index: number) => string | undefined;
  /** Remove the row at `index` from the draft. */
  onRemove: (index: number) => void;
  /** aria-label for a row's × button (e.g. `` `Remove field ${i + 1}` ``). */
  removeLabel: (index: number) => string;
  /** Shown as a single full-width row when there are no rows. */
  emptyText: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-left text-muted-foreground uppercase tracking-wider">
            {columns.map((c, i) => <th key={i} className="p-1 font-bold">{c.header}</th>)}
            <th className="p-1" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              className={cn(rowClassName?.(row, i))}
              {...(rowTestId ? { "data-testid": rowTestId(row, i) } : {})}
            >
              {columns.map((c, j) => <td key={j} className="p-1">{c.cell(row, i)}</td>)}
              <td className="p-1">
                <button
                  type="button"
                  aria-label={removeLabel(i)}
                  onClick={() => onRemove(i)}
                  className="text-muted-foreground hover:text-red-500 px-2"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={columns.length + 1} className="p-3 text-center text-muted-foreground">{emptyText}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
