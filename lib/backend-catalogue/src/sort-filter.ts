import { PRIORITY_RANK, CANONICAL_STATUS, canonicalStatusOf } from "./work-vocabulary";
import { CANONICAL_TASK_STATUS } from "./task-vocabulary";
import { ENERGY_LEVEL } from "./energy-vocabulary";
import { SEVERITY_LEVEL } from "./severity-vocabulary";
import { IMPACT_LEVEL } from "./impact-vocabulary";
import { LIKELIHOOD_LEVEL } from "./likelihood-vocabulary";
import { RAG_BAND_LEVEL } from "./rag-vocabulary";

/**
 * SORT + FILTER — the ONE shared, pure "view controls" engine a screen table or a report row-set runs so a
 * user can sort by ANY column (or row) and filter, with the SAME comparators everywhere. It lives beneath the
 * broker seam (like `rollup`) so both planes — the SPA panels and the api-server report/rows endpoints — use
 * one implementation and can never disagree on ordering.
 *
 * Four column kinds, each with a correct comparator:
 *   - string  → locale-aware (case/accent-insensitive) A→Z;
 *   - number  → numeric;
 *   - date    → date-aware (ISO/parseable strings → epoch), so "2026-01-02" sorts after "2026-01-01";
 *   - ordinal → by the value's INTERNAL LEVEL, not its display label. A graded value (status / priority /
 *     severity / energy / RAG / impact / likelihood) sorts by the canonical level it binds to (see the
 *     leveled-vocabulary model), so the order is correct however the token is RELABELLED or LOCALISED — a
 *     "Critical"/"Kritisch"/"Sev-1" severity all sort by the same underlying level. {@link ORDINAL_LEVELS_BY_KIND}
 *     supplies the shipped default map per kind; a caller may pass its own (a scope-resolved adjustable vocab).
 *
 * MISSING VALUES SORT LAST in BOTH directions (an empty/absent/uncomparable cell never floats to the top when
 * a column is sorted descending) — the behaviour a table user expects. Sorts are STABLE (original order breaks
 * ties). PURE: no I/O, no clock (dates parse from the row value).
 */

export type SortDir = "asc" | "desc";
export type SortKind = "string" | "number" | "date" | "ordinal";
export type Row = Record<string, unknown>;

/** One sort instruction: a column, a direction (default asc), how to compare it, and — for an ordinal column —
 *  the value→level map (defaults to the shipped map for a known {@link OrdinalKind} via {@link ordinalSortKey}). */
export interface SortKey {
  field: string;
  dir?: SortDir;
  kind?: SortKind;
  /** ordinal only: value (id or label) → its internal level (higher = greater). */
  levels?: Record<string, number>;
}

const str = (v: unknown): string => (v == null ? "" : String(v)).trim();

/** Parse a number-ish value (a real number, or a numeric string), else null (missing/uncomparable). */
export const asNumber = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = str(v);
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Parse a date-ish string to epoch millis, else null. Only strings — a bare number is a number, not a date. */
export const asDateMs = (v: unknown): number | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s === "") return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

// ── Ordinal level maps — one per graded kind, from the leveled-vocabulary bindings ─────────────────────────
const indexLevels = (ids: readonly string[]): Record<string, number> => Object.fromEntries(ids.map((id, i) => [id, i]));

/** status / task-status order by their board position (backlog…cancelled / next…dropped); the graded kinds
 *  by the internal level each token binds to. This is the invariant an ordinal sort keys off. */
export const ORDINAL_LEVELS_BY_KIND = {
  status: indexLevels(CANONICAL_STATUS),
  taskStatus: indexLevels(CANONICAL_TASK_STATUS),
  priority: PRIORITY_RANK as Record<string, number>,
  energy: ENERGY_LEVEL as Record<string, number>,
  severity: SEVERITY_LEVEL as Record<string, number>,
  impact: IMPACT_LEVEL as Record<string, number>,
  likelihood: LIKELIHOOD_LEVEL as Record<string, number>,
  rag: RAG_BAND_LEVEL as Record<string, number>,
} as const;

export type OrdinalKind = keyof typeof ORDINAL_LEVELS_BY_KIND;

/** The internal ordinal level of a graded `value` in `kind`, using the shipped default map. A status also
 *  resolves through its canonical binding (so an ADJUSTABLE status sorts by the level it binds to). Null when
 *  the value isn't a known token of that kind. */
export function ordinalLevel(kind: OrdinalKind, value: unknown): number | null {
  const map = ORDINAL_LEVELS_BY_KIND[kind];
  const key = str(value);
  if (key in map) return map[key]!;
  if (kind === "status") {
    const canon = canonicalStatusOf(key);
    return canon != null ? (ORDINAL_LEVELS_BY_KIND.status[canon] ?? null) : null;
  }
  return null;
}

/** Build a {@link SortKey} for a known graded column, wiring its shipped default level map. Pass `dir`
 *  (default asc). Callers with an adjustable/relabelled vocab can instead set `levels` on a plain SortKey. */
export function ordinalSortKey(field: string, kind: OrdinalKind, dir: SortDir = "asc"): SortKey {
  return { field, kind: "ordinal", dir, levels: ORDINAL_LEVELS_BY_KIND[kind] };
}

/** The comparable value for one sort key: a string for `string`, else a number (or null = missing/last). */
function normalize(key: SortKey, v: unknown): string | number | null {
  switch (key.kind ?? "string") {
    case "number": return asNumber(v);
    case "date": return asDateMs(v);
    case "ordinal": { const k = str(v); const lv = key.levels?.[k]; return lv === undefined ? null : lv; }
    default: { const s = str(v); return s === "" ? null : s; }
  }
}

/** A comparator for one sort key. Missing values (null) sort LAST regardless of direction; present values
 *  compare by kind (strings locale-aware), then the direction sign is applied. */
export function compareRows(key: SortKey): (a: Row, b: Row) => number {
  const dir = key.dir === "desc" ? -1 : 1;
  return (a, b) => {
    const av = normalize(key, a[key.field]);
    const bv = normalize(key, b[key.field]);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;  // a missing → after b, whatever the direction
    if (bv === null) return -1;
    const base = typeof av === "string" && typeof bv === "string"
      ? av.localeCompare(bv, undefined, { sensitivity: "base", numeric: true })
      : av < bv ? -1 : av > bv ? 1 : 0;
    return base * dir;
  };
}

/** Sort rows by one or more keys (earlier keys dominate), stably (original order breaks a full tie). Pure —
 *  returns a new array. No keys ⇒ a shallow copy in the original order. */
export function sortRows<T extends Row>(rows: readonly T[], keys: readonly SortKey[]): T[] {
  if (!keys.length) return rows.slice();
  const cmps = keys.map(compareRows);
  return rows
    .map((r, i) => [r, i] as const)
    .sort(([a, ai], [b, bi]) => {
      for (const c of cmps) { const d = c(a as Row, b as Row); if (d) return d; }
      return ai - bi; // stable: preserve input order on a full tie
    })
    .map(([r]) => r);
}

// ── Filters — the shared predicate set (dates + numbers + ordinals compare the SAME way as the sort) ───────
export type FilterOp = "eq" | "ne" | "in" | "nin" | "lt" | "lte" | "gt" | "gte" | "contains" | "truthy" | "falsy";

/** One filter predicate on a column. `op:"in"/"nin"` take an array; the ordering ops (`lt`…`gte`) compare
 *  number-aware then date-aware; `contains` is a case-insensitive substring; `truthy`/`falsy` ignore `value`.
 *  For an ordinal column, set `kind:"ordinal"` (+ `levels`, or a known {@link OrdinalKind}) so `lt`…`gte`
 *  compare by internal level rather than label text. */
export interface FilterPredicate {
  field: string;
  op: FilterOp;
  value?: unknown;
  kind?: SortKind;
  levels?: Record<string, number>;
}

/** Comparable magnitude of a value for an ordering op, honouring the predicate's kind (ordinal → level;
 *  else number then date). Null ⇒ not comparable (the predicate fails). */
function magnitude(p: Pick<FilterPredicate, "kind" | "levels">, v: unknown): number | null {
  if (p.kind === "ordinal") { const lv = p.levels?.[str(v)]; return lv === undefined ? null : lv; }
  return asNumber(v) ?? asDateMs(v);
}

/** Evaluate one predicate against a row. */
export function evalFilter(p: FilterPredicate, row: Row): boolean {
  const actual = row[p.field];
  switch (p.op) {
    case "truthy": return !!actual;
    case "falsy": return !actual;
    case "eq": return str(actual) === str(p.value);
    case "ne": return str(actual) !== str(p.value);
    case "in": return Array.isArray(p.value) && p.value.map(str).includes(str(actual));
    case "nin": return Array.isArray(p.value) && !p.value.map(str).includes(str(actual));
    case "contains": return str(actual).toLowerCase().includes(str(p.value).toLowerCase());
    case "lt": case "lte": case "gt": case "gte": {
      const a = magnitude(p, actual), b = magnitude(p, p.value);
      if (a === null || b === null) return false;
      return p.op === "gt" ? a > b : p.op === "gte" ? a >= b : p.op === "lt" ? a < b : a <= b;
    }
    default: return false;
  }
}

/** Keep rows matching EVERY predicate (AND). Empty/absent predicates ⇒ every row passes. Pure. */
export function filterRows<T extends Row>(rows: readonly T[], predicates: readonly FilterPredicate[] = []): T[] {
  if (!predicates.length) return rows.slice();
  return rows.filter((r) => predicates.every((p) => evalFilter(p, r)));
}

/** The common "view" application: filter THEN sort, in one pure pass. This is what a screen table or a report
 *  row-set calls to honour a user's live column sort + filters over any row shape. */
export function applyView<T extends Row>(rows: readonly T[], opts: { filters?: readonly FilterPredicate[]; sort?: readonly SortKey[] } = {}): T[] {
  return sortRows(filterRows(rows, opts.filters ?? []), opts.sort ?? []);
}
