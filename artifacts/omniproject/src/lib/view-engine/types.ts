/**
 * Generic view engine — the entity-agnostic contract that lets the SAME view components (board,
 * list, …) render ANY record type. Tasks and issues are treated identically: each supplies an
 * `EntityDescriptor` and the engine renders it through whichever view the user picks. GTD is not a
 * data-model constraint — it's just one board column-preset among others, selectable like any view.
 */

/** A small metadata chip shown under a record's title (e.g. a context tag, assignee, due date). */
export interface Chip {
  text: string;
  /** Render in a monospace face (for tags / ids / contexts). */
  mono?: boolean;
}

/** A record normalised for display, carrying a reference to the raw entity for detail/open. */
export interface ViewRecord<T = unknown> {
  id: string;
  title: string;
  status: string;
  /** Canonical priority (e.g. "high"), or null when unset. Rendered as a badge. */
  priority: string | null;
  /** Extra metadata chips shown under the title. */
  chips: Chip[];
  /** The underlying entity, handed back to `onOpen` so the page can show its own detail view. */
  raw: T;
}

/** One board column — records whose status equals `status` land here. */
export interface BoardColumn {
  status: string;
  label: string;
}

/** A named set of board columns. GTD, kanban-flow, etc. are all just presets. */
export interface ColumnPreset {
  id: string;
  label: string;
  columns: BoardColumn[];
}

/** A field on the entity that can be filtered / sorted / grouped by in the view builder. `get`
 *  extracts the comparable string value from the raw record (null/undefined = unset). */
export interface EntityField<T = unknown> {
  key: string;
  label: string;
  get: (raw: T) => string | null | undefined;
}

/** Where the records come from — a project scope for issues, or portfolio-wide (no projectId). */
export interface ViewScope {
  projectId?: string;
}

/** What the engine renders records into. `list` plus one entry per board column-preset id. */
export type ViewKind = "list" | (string & {});

/**
 * The per-entity adapter the view engine renders through. Tasks and issues each provide one; the
 * engine never knows which entity it's showing. Hooks are declared as fields so a descriptor can be
 * a plain object — the engine calls them from its own component body (Rules-of-Hooks safe: a given
 * descriptor's hooks are always called in the same order).
 */
export interface EntityDescriptor<T = unknown> {
  /** Canonical entity id, e.g. "task" | "issue". */
  entity: string;
  /** Singular noun for labels / empty states / aria, e.g. "task". */
  noun: string;
  /** Board column presets. The first is the default board view; GTD is one of these. */
  presets: ColumnPreset[];
  /** Fields exposed to the view builder for filter / sort / group-by. */
  fields: EntityField<T>[];
  /** Statuses offered as list filter tabs, in display order. */
  filterStatuses: string[];
  /** Statuses that count as closed/done (list checkbox ticked, title struck through). */
  closedStatuses: string[];
  /** Status a record moves to when completed from the list checkbox. */
  doneStatus: string;
  /** Status a record moves back to when reopened from the list checkbox. */
  reopenStatus: string;
  /** Fetch the records for a scope (a hook). */
  useRecords: (scope: ViewScope) => { records: ViewRecord<T>[]; isLoading: boolean; error: unknown };
  /** A status-mover (a hook returning `(record, status) => void`). */
  useMove: () => (record: ViewRecord<T>, status: string) => void;
  /** Display label for a canonical priority value (a hook returning the mapper). */
  usePriorityLabel: () => (p: string | null | undefined) => string;
}
