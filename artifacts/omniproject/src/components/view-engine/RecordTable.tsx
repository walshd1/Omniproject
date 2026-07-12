import { useMemo } from "react";
import type { EntityField, ViewRecord } from "../../lib/view-engine/types";
import { DataTable, type DataColumn } from "../tables/DataTable";

/**
 * Generic sortable table — the engine's `table` view kind, a thin adapter over the shared
 * {@link DataTable} primitive. Columns come from the entity's field catalog (a saved view's
 * `columns`, or all fields by default), so the SAME table renders tasks or issues; the leading
 * "Title" column opens the record's detail.
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
  const cols = useMemo<DataColumn<ViewRecord<T>>[]>(() => {
    const chosen = columns && columns.length ? columns : fields.map((f) => f.key);
    const fieldCols = chosen
      .map((k) => fields.find((f) => f.key === k))
      .filter((f): f is EntityField<T> => !!f)
      .map((f) => ({
        key: f.key,
        label: f.label,
        sortable: true,
        sortValue: (r: ViewRecord<T>) => f.get(r.raw) ?? "",
        render: (r: ViewRecord<T>) => <span className="text-muted-foreground">{f.get(r.raw) ?? "—"}</span>,
      }));
    return [
      { key: "__title", label: "Title", render: (r: ViewRecord<T>) => <button type="button" onClick={() => onOpen(r)} className="text-left hover:underline">{r.title}</button> },
      ...fieldCols,
    ];
  }, [columns, fields, onOpen]);

  if (records.length === 0) return <p className="text-sm text-muted-foreground" data-testid={`${noun}-table-empty`}>No {noun}s.</p>;

  return (
    <div className="border border-border bg-card" data-testid="record-table">
      <DataTable columns={cols} rows={records} rowKey={(r) => r.id} />
    </div>
  );
}
