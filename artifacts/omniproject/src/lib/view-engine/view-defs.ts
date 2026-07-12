import type { BoardColumn, EntityDescriptor } from "./types";
import type { SavedView } from "../saved-views";

/**
 * A view is a JSON definition rendered by the engine — one schema for both the shipped built-ins and
 * user-authored custom views. Built-ins are read-only (`builtin: true`, derived from the descriptor);
 * custom views come from the saved-views store and are editable in the view builder. The engine
 * dispatches on `kind`, so any new view is just a new definition, never new bespoke code.
 */
export interface ViewDefinition {
  id: string;
  name: string;
  entity: string;
  kind: "list" | "table" | "board" | "timeline";
  /** Read-only shipped definition (can't be edited/deleted) vs. a user's custom view. */
  builtin: boolean;
  /** board: the status→column layout. */
  boardColumns?: BoardColumn[];
  /** table: the visible field columns (empty/absent = all fields). */
  columns?: string[];
  /** timeline: the date field that buckets records. */
  dateField?: string;
  /** list/table: equality filters and a sort. */
  filters?: { field: string; value: string }[];
  sort?: { field: string; dir: "asc" | "desc" };
  /** list: group rows by a field. */
  groupBy?: string;
  /** The plain built-in list carries the status-filter tabs; custom list views don't. */
  statusFilter?: boolean;
}

/** The read-only built-in views for an entity, derived from its descriptor (list, table, timeline
 *  when the entity has a date field, and one board per column-preset). */
export function builtinViewsFor<T>(d: EntityDescriptor<T>): ViewDefinition[] {
  const defs: ViewDefinition[] = [
    { id: `${d.entity}:list`, name: "List", entity: d.entity, kind: "list", builtin: true, statusFilter: true },
    { id: `${d.entity}:table`, name: "Table", entity: d.entity, kind: "table", builtin: true },
  ];
  if (d.fields.some((f) => f.isDate)) {
    defs.push({ id: `${d.entity}:timeline`, name: "Timeline", entity: d.entity, kind: "timeline", builtin: true });
  }
  for (const p of d.presets) {
    defs.push({ id: `${d.entity}:${p.id}`, name: p.label, entity: d.entity, kind: "board", builtin: true, boardColumns: p.columns });
  }
  return defs;
}

/** Adapt a stored (editable) saved view into the unified view-definition shape. */
export function savedViewToDefinition(v: SavedView): ViewDefinition {
  return {
    id: v.id,
    name: v.name,
    entity: v.entity ?? "",
    kind: v.viewKind ?? "list",
    builtin: false,
    ...(v.columns ? { columns: v.columns } : {}),
    ...(v.dateField ? { dateField: v.dateField } : {}),
    ...(v.filters ? { filters: v.filters } : {}),
    ...(v.sort ? { sort: v.sort } : {}),
    ...(v.groupBy ? { groupBy: v.groupBy } : {}),
  };
}
