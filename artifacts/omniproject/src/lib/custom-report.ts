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
  metrics: CustomReportMetric[];
  filter?: ConditionSet;
  viz: "table" | "bar";
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
}

export interface CustomReportResult {
  groups: CustomReportGroup[];
  /** The same metrics aggregated across ALL matched rows (the grand-total row). */
  grand: Record<string, number>;
  matched: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const GROUP_NONE = "—";

/** Run a report definition over rows: filter, group, aggregate. Groups are sorted by the first metric desc. */
export function runCustomReport(def: CustomReportDef, rows: readonly Row[]): CustomReportResult {
  const matched = rows.filter((r) => matchRow(def.filter, r));
  const buckets = new Map<string, Row[]>();
  for (const r of matched) {
    const key = def.groupBy ? String(r[def.groupBy] ?? GROUP_NONE) : "All";
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(r);
  }
  const cellsFor = (group: readonly Row[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const m of def.metrics) {
      const vals = m.agg === "count" ? [] : group.map((r) => asNum(r[m.field])).filter((n): n is number => n !== null);
      out[m.id] = round2(aggregate(m.agg, vals, group.length));
    }
    return out;
  };
  const groups: CustomReportGroup[] = [...buckets.entries()].map(([key, rs]) => ({ key, label: key, count: rs.length, cells: cellsFor(rs) }));
  const first = def.metrics[0]?.id;
  if (first) groups.sort((a, b) => (b.cells[first] ?? 0) - (a.cells[first] ?? 0));
  return { groups, grand: cellsFor(matched), matched: matched.length };
}

/** A readable default label for a metric ("Sum of budget"). */
export function metricLabel(m: CustomReportMetric): string {
  if (m.label) return m.label;
  const verb = m.agg === "count" ? "Count" : `${m.agg[0]!.toUpperCase()}${m.agg.slice(1)} of`;
  return m.agg === "count" ? "Count" : `${verb} ${m.field}`;
}
