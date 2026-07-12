import { useMemo, useState } from "react";
import type { EntityField, ViewRecord } from "../../lib/view-engine/types";

/**
 * Generic sortable table — the engine's `table` view kind. Columns are chosen from the entity's field
 * catalog (a saved view's `columns`, or all fields by default), so the SAME table renders tasks or
 * issues. Click a header to sort. This is the read-only substrate the built-in "list/table" views and
 * custom table views both render through.
 */
export function RecordTable<T>({
  records,
  fields,
  columns,
  noun,
  onOpen,
}: {
  records: ViewRecord<T>[];
  fields: EntityField<T>[];
  columns?: string[];
  noun: string;
  onOpen: (record: ViewRecord<T>) => void;
}) {
  const cols = useMemo(() => {
    const chosen = columns && columns.length ? columns : fields.map((f) => f.key);
    return chosen.map((k) => fields.find((f) => f.key === k)).filter((f): f is EntityField<T> => !!f);
  }, [columns, fields]);

  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const rows = useMemo(() => {
    if (!sort) return records;
    const f = fields.find((x) => x.key === sort.key);
    if (!f) return records;
    return [...records].sort((a, b) => {
      const av = f.get(a.raw) ?? "";
      const bv = f.get(b.raw) ?? "";
      return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
    });
  }, [records, sort, fields]);

  const toggle = (k: string) => setSort((s) => (s?.key === k ? { key: k, dir: (s.dir * -1) as 1 | -1 } : { key: k, dir: 1 }));

  if (records.length === 0) return <p className="text-sm text-muted-foreground" data-testid={`${noun}-table-empty`}>No {noun}s.</p>;

  return (
    <div className="overflow-auto border border-border bg-card" data-testid="record-table">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-background border-b border-border text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <tr>
            <th scope="col" className="text-left px-3 py-2">Title</th>
            {cols.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th key={c.key} scope="col" aria-sort={active ? (sort!.dir === 1 ? "ascending" : "descending") : "none"} className="text-left px-3 py-2 select-none">
                  <button type="button" onClick={() => toggle(c.key)} className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                    {c.label}
                    <span aria-hidden="true">{active ? (sort!.dir === 1 ? "▲" : "▼") : ""}</span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border/60 last:border-0">
              <td className="px-3 py-2">
                <button type="button" onClick={() => onOpen(r)} className="text-left hover:underline">{r.title}</button>
              </td>
              {cols.map((c) => <td key={c.key} className="px-3 py-2 text-muted-foreground">{c.get(r.raw) ?? "—"}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
