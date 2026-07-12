import { useMemo, useState, type ReactNode } from "react";

/**
 * A data-agnostic table primitive — columns + rows, optional per-column sorting, the same principle as
 * the chart/tile primitives. A column names how to render its cell (`render`) and, when sortable, how
 * to compare (`sortValue`). Any data source can render a table without hand-rolling `<table>` markup.
 */
export interface DataColumn<T> {
  key: string;
  label: ReactNode;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  /** Cell content for a row (defaults to the row's `key` field stringified). */
  render?: (row: T) => ReactNode;
  /** Comparable value for sorting (defaults to `render`'s value when it's primitive). */
  sortValue?: (row: T) => string | number;
}

const alignClass = (a: DataColumn<unknown>["align"]) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");

export function DataTable<T>({ columns, rows, rowKey, initialSort, caption, footer, dense = false, testId }: {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string;
  initialSort?: { key: string; dir: 1 | -1 };
  caption?: ReactNode;
  /** An optional footer row (e.g. a totals row), rendered as-is inside the table. */
  footer?: ReactNode;
  dense?: boolean;
  testId?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(initialSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    return [...rows].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
    });
  }, [rows, sort, columns]);

  const toggle = (key: string) => setSort((s) => (s?.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  const pad = dense ? "py-1.5 px-2" : "py-2 px-2";

  return (
    <div className="overflow-x-auto" {...(testId ? { "data-testid": testId } : {})}>
      <table className="w-full text-sm border-collapse">
        {caption && <caption className="text-left text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{caption}</caption>}
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th key={c.key} scope="col" className={`${pad} font-bold ${alignClass(c.align)} select-none`}
                  {...(active ? { "aria-sort": (sort!.dir === 1 ? "ascending" : "descending") as "ascending" | "descending" } : {})}>
                  {c.sortable && c.sortValue ? (
                    <button type="button" onClick={() => toggle(c.key)} className="inline-flex items-center gap-1 uppercase tracking-widest hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                      {c.label}
                      <span aria-hidden="true">{active ? (sort!.dir === 1 ? "▲" : "▼") : ""}</span>
                    </button>
                  ) : c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={rowKey(row, i)} className="border-b border-border/50">
              {columns.map((c) => (
                <td key={c.key} className={`${pad} ${alignClass(c.align)} ${c.align === "right" ? "tabular-nums" : ""}`}>
                  {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
          {footer}
        </tbody>
      </table>
    </div>
  );
}
