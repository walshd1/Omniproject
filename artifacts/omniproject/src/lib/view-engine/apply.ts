import type { EntityField, ViewRecord } from "./types";

/** The slice of a view definition the engine needs to filter + sort a record list. */
export interface FilterSortSpec {
  filters?: { field: string; value: string }[];
  sort?: { field: string; dir: "asc" | "desc" };
}

/** Index an entity's fields by key for quick lookup. */
export function fieldMap<T>(fields: EntityField<T>[]): Record<string, EntityField<T>> {
  return Object.fromEntries(fields.map((f) => [f.key, f]));
}

/** Apply a view's filters (AND-combined equality) and sort to a record list. */
export function applyFiltersSort<T>(records: ViewRecord<T>[], view: FilterSortSpec, fields: EntityField<T>[]): ViewRecord<T>[] {
  const fm = fieldMap(fields);
  let out = records;
  for (const f of view.filters ?? []) {
    const field = fm[f.field];
    if (!field) continue; // ignore filters on fields this entity doesn't expose
    out = out.filter((r) => (field.get(r.raw) ?? "") === f.value);
  }
  if (view.sort) {
    const field = fm[view.sort.field];
    if (field) {
      const dir = view.sort.dir === "desc" ? -1 : 1;
      out = [...out].sort((a, b) => {
        const av = field.get(a.raw) ?? "";
        const bv = field.get(b.raw) ?? "";
        return av < bv ? -dir : av > bv ? dir : 0;
      });
    }
  }
  return out;
}

/** Split records into labelled groups by a field. Ungrouped values collapse under "—". */
export function groupRecords<T>(records: ViewRecord<T>[], groupBy: string | undefined, fields: EntityField<T>[]): { key: string; records: ViewRecord<T>[] }[] {
  if (!groupBy) return [{ key: "", records }];
  const field = fieldMap(fields)[groupBy];
  if (!field) return [{ key: "", records }];
  const groups = new Map<string, ViewRecord<T>[]>();
  for (const r of records) {
    const k = field.get(r.raw) || "—";
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  return [...groups.entries()].map(([key, recs]) => ({ key, records: recs }));
}
