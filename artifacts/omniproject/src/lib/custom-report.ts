import { round2 } from "./num";
import type { ConditionSet, Predicate } from "./rate-card";

/**
 * Bespoke report engine (the report generator) — runs a customer-authored definition over a set of rows:
 * filter by a predicate, group by a field, and aggregate the chosen metrics. Pure and derive-only, so the
 * whole thing is unit-testable and nothing is stored. Mirrors the server's predicate semantics so a report
 * filters identically wherever it runs.
 */

export type CustomReportAgg = "sum" | "avg" | "count" | "min" | "max";

export interface CustomReportMetric {
  id: string;
  field: string;
  agg: CustomReportAgg;
  label?: string;
}

export interface CustomReportDef {
  id: string;
  label: string;
  scope: "project" | "portfolio";
  groupBy?: string;
  /** Second group-by level — turns the report into a cross-tab (pivot): `groupBy` gives the rows,
   *  `groupBy2` the columns, each cell the first metric aggregated over that (row, column) pair.
   *  Ignored without `groupBy`, and for `viz: "line"`. */
  groupBy2?: string;
  metrics: CustomReportMetric[];
  filter?: ConditionSet;
  viz: "table" | "bar" | "line";
  /** Required for `viz: "line"`: a date field whose values are bucketed by month to build a time
   *  trend of the metrics, in place of the categorical `groupBy`. */
  dateField?: string;
}

export type Row = Record<string, unknown>;

const asNum = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Parse a date-like string to epoch millis, else null. Only tried once `asNum` has already failed, so
 *  a numeric literal is never reinterpreted as a date. Backs the `gt`/`gte`/`lt`/`lte` fallback below:
 *  drill-throughs need date comparisons (e.g. "dueDate < today" for an overdue-items filter — see
 *  backlog #132's schedule-variance drill-through), and `Issue.dueDate`/`startDate` are ISO date
 *  strings, not numbers, so `asNum` alone would make date comparisons always false. */
const asDateMs = (v: unknown): number | null => {
  if (typeof v !== "string" || v.trim() === "") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/** Evaluate one predicate against a row (mirrors the server predicate engine). */
function evalPredicate(p: Predicate, row: Row): boolean {
  const actual = row[p.field];
  switch (p.op) {
    case "truthy": return !!actual;
    case "falsy": return !actual;
    case "negative": { const n = asNum(actual); return n !== null && n < 0; }
    case "nonNegative": { const n = asNum(actual); return n !== null && n >= 0; }
    case "eq": return actual === p.value;
    case "ne": return actual !== p.value;
    case "in": return Array.isArray(p.value) && p.value.includes(actual);
    case "nin": return Array.isArray(p.value) && !p.value.includes(actual);
    case "gt": case "gte": case "lt": case "lte": {
      // Numeric fields compare numerically; a non-numeric field (e.g. an ISO date string like
      // dueDate) falls back to a date-aware comparison instead of always failing.
      const a = asNum(actual) ?? asDateMs(actual), b = asNum(p.value) ?? asDateMs(p.value);
      if (a === null || b === null) return false;
      return p.op === "gt" ? a > b : p.op === "gte" ? a >= b : p.op === "lt" ? a < b : a <= b;
    }
    default: return false;
  }
}

/** Does a row pass the filter? (all-of `all` AND any-of `any`; empty/absent ⇒ everything passes.) */
export function matchRow(filter: ConditionSet | undefined, row: Row): boolean {
  if (!filter) return true;
  const all = filter.all ?? [];
  const any = filter.any ?? [];
  if (!all.every((p) => evalPredicate(p, row))) return false;
  if (any.length > 0 && !any.some((p) => evalPredicate(p, row))) return false;
  return true;
}

/** Aggregate a set of field values for one metric. `count` ignores the values (it counts rows). */
function aggregate(agg: CustomReportAgg, values: number[], rowCount: number): number {
  if (agg === "count") return rowCount;
  if (values.length === 0) return 0;
  if (agg === "sum") return values.reduce((s, n) => s + n, 0);
  if (agg === "avg") return values.reduce((s, n) => s + n, 0) / values.length;
  if (agg === "min") return Math.min(...values);
  return Math.max(...values); // max
}

export interface CustomReportGroup {
  key: string;
  label: string;
  count: number;
  /** metric id → aggregated value. */
  cells: Record<string, number>;
  /** Present when `groupBy2` is set: level-2 key (one of `CustomReportResult.columns`) → the
   *  aggregated cell for this row × that column — the pivot proper. */
  pivot?: Record<string, { count: number; cells: Record<string, number> }>;
}

export interface CustomReportResult {
  groups: CustomReportGroup[];
  /** Present when `groupBy2` is set: the distinct level-2 keys (pivot columns), in display order. */
  columns?: string[];
  /** The same metrics aggregated across ALL matched rows (the grand-total row). */
  grand: Record<string, number>;
  matched: number;
}

const GROUP_NONE = "—";

/** Aggregate every metric in `def` over one bucket of rows — shared by the group-by and trend paths. */
function cellsForRows(metrics: readonly CustomReportMetric[], group: readonly Row[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of metrics) {
    const vals = m.agg === "count" ? [] : group.map((r) => asNum(r[m.field])).filter((n): n is number => n !== null);
    out[m.id] = round2(aggregate(m.agg, vals, group.length));
  }
  return out;
}

/** Run a report definition over rows: filter, group, aggregate. Groups are sorted by the first metric
 *  desc. When `groupBy2` is also set, each group additionally carries a `pivot` — a genuine two-level
 *  cross-tab (rows = `groupBy`, columns = the distinct `groupBy2` values), not just a compound key. */
export function runCustomReport(def: CustomReportDef, rows: readonly Row[]): CustomReportResult {
  const matched = rows.filter((r) => matchRow(def.filter, r));
  const buckets = new Map<string, Row[]>();
  for (const r of matched) {
    const key = def.groupBy ? String(r[def.groupBy] ?? GROUP_NONE) : "All";
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(r);
  }
  const cellsFor = (group: readonly Row[]) => cellsForRows(def.metrics, group);

  const columns = def.groupBy && def.groupBy2
    ? [...new Set(matched.map((r) => String(r[def.groupBy2!] ?? GROUP_NONE)))].sort()
    : undefined;

  const groups: CustomReportGroup[] = [...buckets.entries()].map(([key, rs]) => {
    const group: CustomReportGroup = { key, label: key, count: rs.length, cells: cellsFor(rs) };
    if (columns) {
      const pivot: Record<string, { count: number; cells: Record<string, number> }> = {};
      for (const col of columns) {
        const cell = rs.filter((r) => String(r[def.groupBy2!] ?? GROUP_NONE) === col);
        pivot[col] = { count: cell.length, cells: cellsFor(cell) };
      }
      group.pivot = pivot;
    }
    return group;
  });
  const first = def.metrics[0]?.id;
  if (first) groups.sort((a, b) => (b.cells[first] ?? 0) - (a.cells[first] ?? 0));
  return { groups, ...(columns ? { columns } : {}), grand: cellsFor(matched), matched: matched.length };
}

/** One month's aggregated metrics in a `viz: "line"` trend. */
export interface CustomReportTrendPoint {
  /** Sortable "YYYY-MM" bucket key. */
  period: string;
  /** Human label, e.g. "Jul 2026". */
  label: string;
  count: number;
  cells: Record<string, number>;
}

export interface CustomReportTrendResult {
  /** Chronological, ascending. */
  points: CustomReportTrendPoint[];
  /** The same metrics aggregated across every dated row (the grand-total row). */
  grand: Record<string, number>;
  /** Matched rows that also had a parseable `dateField` (and so contributed to a bucket). */
  matched: number;
}

/** Parse `v` as a date and return its "YYYY-MM" bucket key, or null if it isn't a usable date. */
function monthKey(v: unknown): string | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v as string | number);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-07" → "Jul 2026". */
function monthLabel(period: string): string {
  const [y, m] = period.split("-");
  return `${MONTH_NAMES[Number(m) - 1] ?? m} ${y}`;
}

/** Evaluate a `viz: "line"` report: filter, then bucket the matched rows by month of `def.dateField`
 *  and aggregate the metrics per month — a genuine time trend, computed live over the read model like
 *  every other report (nothing but the definition is ever persisted). Rows with no parseable date are
 *  skipped. */
export function runCustomReportTrend(def: CustomReportDef, rows: readonly Row[]): CustomReportTrendResult {
  const filtered = rows.filter((r) => matchRow(def.filter, r));
  const buckets = new Map<string, Row[]>();
  const dated: Row[] = [];
  if (def.dateField) {
    for (const r of filtered) {
      const period = monthKey(r[def.dateField]);
      if (period === null) continue;
      dated.push(r);
      (buckets.get(period) ?? buckets.set(period, []).get(period)!).push(r);
    }
  }
  const points: CustomReportTrendPoint[] = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, rs]) => ({ period, label: monthLabel(period), count: rs.length, cells: cellsForRows(def.metrics, rs) }));
  return { points, grand: cellsForRows(def.metrics, dated), matched: dated.length };
}

/** A readable default label for a metric ("Sum of budget"). */
export function metricLabel(m: CustomReportMetric): string {
  if (m.label) return m.label;
  const verb = m.agg === "count" ? "Count" : `${m.agg[0]!.toUpperCase()}${m.agg.slice(1)} of`;
  return m.agg === "count" ? "Count" : `${verb} ${m.field}`;
}
