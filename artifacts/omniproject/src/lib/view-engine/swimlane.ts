import type { EntityField, ViewRecord } from "./types";
import { groupRecords } from "./apply";

/** One horizontal swimlane on a board: a labelled row of records grouped by a field value. */
export interface Swimlane<T> {
  /** The raw group value ("—" for unset). */
  key: string;
  /** Display label — the group value resolved through the field's vocabulary (e.g. "Done", not "done"). */
  label: string;
  records: ViewRecord<T>[];
}

/**
 * Partition records into ordered swimlanes by a field — the board counterpart to the list view's
 * `groupRecords`, so a board grouped by X and a list grouped by X split identically. Lane LABELS are
 * resolved through the same vocabulary the rest of the view uses (via the optional `labelFor` mapper —
 * e.g. the status/priority label functions the board already holds), keeping lane text consistent with
 * columns and chips. The unset ("—") lane always sorts last. Returns `[]` when there is no grouping
 * (no `groupBy`, or an unknown field) so the board falls back to its flat, laneless layout.
 */
export function toSwimlanes<T>(
  records: ViewRecord<T>[],
  groupBy: string | undefined,
  fields: EntityField<T>[],
  labelFor?: (value: string) => string,
): Swimlane<T>[] {
  if (!groupBy) return [];
  const groups = groupRecords(records, groupBy, fields);
  // groupRecords collapses to a single ""-keyed group when the field is absent/unknown → no lanes.
  if (groups.length === 1 && groups[0]!.key === "") return [];
  return groups
    .map((g) => ({ key: g.key, label: g.key === "—" ? "—" : (labelFor?.(g.key) ?? g.key), records: g.records }))
    .sort((a, b) => (a.key === "—" ? 1 : 0) - (b.key === "—" ? 1 : 0));
}
