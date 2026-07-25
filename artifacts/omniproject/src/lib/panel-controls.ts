import {
  rollup, sortRows, ordinalSortKey, ORDINAL_LEVELS_BY_KIND,
  type Agg, type SortKey, type SortKind, type SortDir, type OrdinalKind,
} from "@workspace/backend-catalogue";

/**
 * Generic PANEL CONTROLS — an optional, JSON-enabled period selector + pivot-style filter/group/aggregate
 * that any `table` or `chart` panel can turn on with one `controls` block. It reuses the ONE shared `rollup`
 * engine (same as the backend rows endpoints and custom reports), so a user can, live in the browser: pick a
 * grouping dimension (incl. derived period buckets — year / quarter / month), a metric + aggregation, and
 * filter rows by any configured field. Nothing new server-side: the panel fetches raw rows once and this
 * pivots them on the fly.
 */
export type { Agg };

/** The `config.controls` block a panel declares to switch controls on. */
export interface ControlsConfig {
  /** Selectable grouping dimensions (field names). First is the default. */
  groupBy?: string[];
  /** The measure field for sum/avg/min/max (count ignores it). */
  metricField?: string;
  /** Label for the measure column/series. */
  metricLabel?: string;
  /** Selectable aggregations. First is the default. Defaults to ["sum","avg","count","min","max"]. */
  aggs?: Agg[];
  /** Fields the user may filter on (a value picker per field). */
  filters?: string[];
  /** Columns the user may sort on. Each names how to compare it: a plain {@link SortKind}
   *  (string/number/date) OR a graded {@link OrdinalKind} (priority/severity/status/…), so a graded column
   *  sorts by its internal LEVEL not its label. Absent ⇒ no sort control. */
  sortable?: Array<{ field: string; label?: string; kind?: SortKind | OrdinalKind }>;
  /** Optional period bucketing: derive year/quarter/month buckets from a date-ish `field`. */
  period?: { field: string; buckets: Array<"year" | "quarter" | "month"> };
}

/** The live control state the UI drives. */
export interface ControlsState {
  /** A configured field name, or `period:year|quarter|month` for a derived period bucket. */
  groupBy: string;
  agg: Agg;
  /** field → the set of allowed values (empty ⇒ all). */
  filters: Record<string, string[]>;
  /** Active column sort (absent ⇒ the natural row order). */
  sort?: { field: string; dir: SortDir };
}

/** Resolve a config sort entry to a {@link SortKey}: a graded kind wires its shipped level map (sort by
 *  internal level), otherwise it's a plain string/number/date compare. */
function toSortKey(field: string, kind: SortKind | OrdinalKind | undefined, dir: SortDir): SortKey {
  if (kind && kind in ORDINAL_LEVELS_BY_KIND) return ordinalSortKey(field, kind as OrdinalKind, dir);
  return { field, kind: (kind as SortKind) ?? "string", dir };
}

/** The sortable-column options for the UI (empty when none configured). */
export function sortOptions(config: ControlsConfig): Array<{ value: string; label: string }> {
  return (config.sortable ?? []).map((s) => ({ value: s.field, label: s.label ?? s.field }));
}

const s = (v: unknown): string => (v == null ? "" : String(v));

/** Bucket a free-form period/date label ("2026", "2026-03", "2026-Q1") to a coarser grain. */
export function bucketPeriod(value: unknown, bucket: "year" | "quarter" | "month"): string {
  const v = s(value).trim();
  const year = /^(\d{4})/.exec(v)?.[1];
  if (!year) return v || "—";
  if (bucket === "year") return year;
  const q = /Q([1-4])/i.exec(v)?.[1];
  const mm = /^\d{4}[-/](\d{1,2})/.exec(v)?.[1];
  if (bucket === "quarter") {
    if (q) return `${year}-Q${q}`;
    if (mm) return `${year}-Q${Math.ceil(Number(mm) / 3)}`;
    return year;
  }
  // month
  return mm ? `${year}-${String(Number(mm)).padStart(2, "0")}` : v;
}

/** All grouping options for the UI: the configured dimensions plus any period buckets. */
export function groupByOptions(config: ControlsConfig): Array<{ value: string; label: string }> {
  const dims = (config.groupBy ?? []).map((f) => ({ value: f, label: f }));
  const periods = (config.period?.buckets ?? []).map((b) => ({ value: `period:${b}`, label: `by ${b}` }));
  return [...periods, ...dims];
}

/** The default control state for a config. */
export function defaultControlsState(config: ControlsConfig): ControlsState {
  const options = groupByOptions(config);
  return {
    groupBy: options[0]?.value ?? "",
    agg: config.aggs?.[0] ?? "sum",
    filters: {},
  };
}

/** Distinct string values of a field across the rows (for a filter picker). */
export function distinctValues(rows: readonly Record<string, unknown>[], field: string): string[] {
  return [...new Set(rows.map((r) => s(r[field])).filter((v) => v !== ""))].sort();
}

export interface ControlsResult {
  rows: Array<Record<string, unknown>>;
  /** The field the result is grouped on (the table's first column / the chart's x). */
  groupByField: string;
  /** The metric column/series key in the result rows. */
  metricKey: string;
  /** A display label for the metric. */
  metricLabel: string;
}

/**
 * Apply the live control state to the raw rows: FILTER → (derive period bucket) → ROLLUP. Pure. Returns the
 * pivoted rows plus the group + metric keys so a table or chart can render them generically.
 */
export function applyControls(rawRows: readonly Record<string, unknown>[], config: ControlsConfig, state: ControlsState): ControlsResult {
  // 1. Filter: keep rows whose value for each active filter is in the selected set.
  let rows = rawRows.filter((r) => Object.entries(state.filters).every(([field, allowed]) => allowed.length === 0 || allowed.includes(s(r[field]))));

  // 2. Derive the grouping field (a period bucket becomes a synthetic column).
  let groupByField = state.groupBy;
  if (state.groupBy.startsWith("period:") && config.period) {
    const bucket = state.groupBy.slice("period:".length) as "year" | "quarter" | "month";
    groupByField = "period";
    rows = rows.map((r) => ({ ...r, period: bucketPeriod(r[config.period!.field], bucket) }));
  }

  // 3. Roll up with the ONE shared engine.
  const metricField = config.metricField ?? "";
  const metrics = state.agg === "count" ? [{ field: "", agg: "count" as Agg }] : [{ field: metricField, agg: state.agg }];
  let out = groupByField ? rollup(rows, { groupBy: groupByField, metrics }) : rows.slice();
  const metricKey = state.agg === "count" ? "count" : metricField;
  const metricLabel = config.metricLabel ?? (state.agg === "count" ? "count" : `${state.agg} ${metricField}`);

  // 4. Sort (if the user picked a column) with the ONE shared comparator — dates + ordinal levels included.
  if (state.sort) {
    const kind = (config.sortable ?? []).find((s) => s.field === state.sort!.field)?.kind;
    out = sortRows(out, [toSortKey(state.sort.field, kind, state.sort.dir)]);
  }
  return { rows: out, groupByField, metricKey, metricLabel };
}
