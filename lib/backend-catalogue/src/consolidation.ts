/**
 * Generic group consolidation engine — the ONE fold behind every "consolidate a per-project figure into
 * one reporting currency, group by programme, derive a ratio, sort" report (portfolio financials, income,
 * benefits). Each of those hand-rolled the identical loop and differed only in WHICH measures to sum, the
 * derived formula and the sort — which is DATA, not code. That spec now lives as JSON under
 * assets/consolidations/ (embedded + drift-guarded like reports / views / mappings); this is the engine
 * that runs it. Pure and derive-only: the caller supplies each project's already-extracted measure values
 * + the FX table; nothing is stored.
 *
 * The derived metrics are a CLOSED vocabulary of named operations (diff / diffFloor0 / ratioPct /
 * ratioOrNull) — never an evaluated expression string — so a spec can't smuggle in executable code.
 */
import { convertAmount, isConvertible } from "./currency";
import { numLoose as num, round1, round2 } from "./num";
import { CONSOLIDATIONS_DATA } from "./consolidations.generated";

/**
 * Track whether every project folded into a roll-up row so far shares one source currency, so the row can
 * show a `local` (un-converted) figure alongside the consolidated total. Once a second currency appears the
 * row is "mixed" and only the consolidated total applies.
 */
export class LocalTracker {
  currency: string | null = null;
  private seen = new Set<string>();

  /** Fold one more project's currency in; returns true while the row is still single-currency. */
  add(currency: string): boolean {
    this.seen.add(currency);
    this.currency = this.seen.size === 1 ? currency : null;
    return this.seen.size === 1;
  }
}


/** The closed set of derived-metric operations a consolidation spec may name. */
export type DerivedOp =
  | "diff" // a − b (e.g. budget − forecast = variance)
  | "diffFloor0" // max(0, a − b) (e.g. projected − invoiced = unbilled, clamped)
  | "ratioPct" // b>0 ? a/b×100 (1dp) : 0 (e.g. invoiced/projected = billed %)
  | "ratioPctOrNull" // b>0 ? a/b×100 (1dp) : null (e.g. assigned/available = utilisation, null when none)
  | "ratioOrNull"; // b>0 ? a/b (2dp) : null (e.g. earnedValue/actual = CPI)

/** How a measure is extracted from a group's items — the field name is DATA, read by the engine. */
export type MeasureAgg =
  | "sum" // Σ item[field]
  | "weightedSum" // Σ item[field] × weight, weight from item[weightField] (clamped, scaled, defaulted)
  | "count" // number of items (field ignored)
  | "countWhere"; // number of items whose item[field] satisfies `op value` (e.g. allocation% > 100)

/** The comparison a `countWhere` measure applies to `item[field]`. */
export type CompareOp = "gt" | "gte" | "lt" | "lte" | "eq";

/** One measure: aggregate a named field across a group's items into `key`. The engine never hardcodes a
 *  field name — it reads `field` / `weightField` from here, exactly as the drill-down resolver reads its
 *  predicate fields from a `DrillTo` descriptor. */
export interface MeasureSpec {
  key: string;
  agg: MeasureAgg;
  /** The item field aggregated into this measure. Ignored for `count`. */
  field?: string;
  /** weightedSum: the item field carrying the per-item weight (e.g. a confidence %). */
  weightField?: string;
  /** weightedSum: multiply the (clamped) weight by this before applying (e.g. 0.01 to turn a % into a fraction). */
  weightScale?: number;
  /** weightedSum: the weight to use when `weightField` is absent/null (in the same units as the raw field). */
  weightDefault?: number;
  /** weightedSum: clamp the raw weight to [0, weightMax] before scaling (e.g. 100 for a percentage). */
  weightMax?: number;
  /** countWhere: the comparison operator applied to `item[field]`. */
  op?: CompareOp;
  /** countWhere: the value `item[field]` is compared against. */
  value?: number;
}

/** One derived metric: apply `op` to two measure (or earlier-declared) keys, storing the result under `key`. */
export interface DerivedMetric {
  key: string;
  op: DerivedOp;
  a: string;
  b: string;
}

/** How to order the resulting rows (by a measure or derived key). Ties always break on the group key. */
export interface ConsolidationSort {
  key: string;
  dir: "asc" | "desc";
}

/** A consolidation spec — authored as JSON under assets/consolidations/<id>.json. */
export interface ConsolidationSpec {
  id: string;
  /** How to extract each measure from a group's items (field name + aggregation) — data, not code. */
  measures: MeasureSpec[];
  /** Derived metrics computed from the RAW (un-rounded) measure sums at finalise. */
  derived: DerivedMetric[];
  /** Row ordering. */
  sort: ConsolidationSort;
}

/** One project's contribution to a consolidation: its group, its currency, and its raw items. The engine
 *  extracts the measure values from `items` per the spec — no field name is baked into the caller. */
export interface ConsolidationInput {
  /** Grouping key (e.g. a programmeId, or a "standalone" sentinel). */
  groupKey: string;
  /** Human label for the group. */
  groupLabel: string;
  /** The project's source currency (drives FX conversion + local-currency tracking). */
  currency: string;
  /** The project's work items — the engine reads each measure's `field` off these. */
  items: readonly Record<string, unknown>[];
}

/** Extract one measure's value from a set of items per its spec — the generic "sum field X" /
 *  "weighted-sum field X by Y" action, with every field name coming from the spec. */
export function measureValue(items: readonly Record<string, unknown>[], m: MeasureSpec): number {
  if (m.agg === "count") return items.length;
  const field = m.field ?? "";
  if (m.agg === "countWhere") {
    const op = m.op ?? "gt";
    const value = m.value ?? 0;
    let n = 0;
    for (const it of items) if (compare(num(it[field]), op, value)) n += 1;
    return n;
  }
  let total = 0;
  for (const it of items) {
    const base = num(it[field]);
    if (m.agg === "weightedSum") {
      const scale = m.weightScale ?? 1;
      const wf = m.weightField;
      const rawWeight = wf != null && it[wf] != null ? num(it[wf]) : (m.weightDefault ?? 1 / scale);
      const weight = Math.min(m.weightMax ?? Infinity, Math.max(0, rawWeight));
      total += base * weight * scale;
    } else {
      total += base;
    }
  }
  return total;
}

/** Extract every measure's value from a group's items — the `{ measureKey: amount }` map the fold folds. */
export function extractMeasures(items: readonly Record<string, unknown>[], measures: MeasureSpec[]): Record<string, number> {
  return Object.fromEntries(measures.map((m) => [m.key, measureValue(items, m)]));
}

/** A consolidated row (a group, or the grand total). Measures + derived metrics land in `metrics`. */
export interface ConsolidatedRow {
  key: string;
  label: string;
  projects: number;
  /** Consolidated (reporting-currency) measure sums + derived metrics, by key. */
  metrics: Record<string, number | null>;
  /** The single local currency shared by every project in the row, or null once it mixes ≥2. */
  localCurrency: string | null;
  /** Un-converted measure sums in `localCurrency` — present only while the row is single-currency. */
  local: Record<string, number> | null;
  /** Projects dropped from the consolidated total for want of an FX rate to the reporting currency. */
  excludedForFx: number;
}

/** Apply one derived operation to two raw measure sums. */
function applyDerived(op: DerivedOp, a: number, b: number): number | null {
  switch (op) {
    case "diff":
      return round2(a - b);
    case "diffFloor0":
      return round2(Math.max(0, a - b));
    case "ratioPct":
      return b > 0 ? round1((a / b) * 100) : 0;
    case "ratioPctOrNull":
      return b > 0 ? round1((a / b) * 100) : null;
    case "ratioOrNull":
      return b > 0 ? round2(a / b) : null;
  }
}

/** Whether `v` satisfies `op value` — the `countWhere` predicate. */
function compare(v: number, op: CompareOp, value: number): boolean {
  switch (op) {
    case "gt":
      return v > value;
    case "gte":
      return v >= value;
    case "lt":
      return v < value;
    case "lte":
      return v <= value;
    case "eq":
      return v === value;
  }
}

interface WorkingRow {
  key: string;
  label: string;
  projects: number;
  sums: Record<string, number>;
  localSums: Record<string, number>;
  local: boolean;
  tracker: LocalTracker;
  excludedForFx: number;
}

function blank(spec: ConsolidationSpec, key: string, label: string): WorkingRow {
  const zero = () => Object.fromEntries(spec.measures.map((m) => [m.key, 0]));
  return { key, label, projects: 0, sums: zero(), localSums: zero(), local: false, tracker: new LocalTracker(), excludedForFx: 0 };
}

/** Fold one project into a row: extract its measure values from its items, FX-convert them into the total
 *  (gated on convertibility), and accumulate the raw amounts as the row's local figure while one currency
 *  is shared. */
function fold(acc: WorkingRow, p: ConsolidationInput, spec: ConsolidationSpec, target: string, rates?: Record<string, number>): void {
  acc.projects += 1;
  const currency = String(p.currency ?? "");
  const values = extractMeasures(p.items, spec.measures);
  // convertAmount passes an amount through UNCHANGED when a rate is missing, so a raw foreign amount
  // would corrupt the consolidated total — only fold measures in when the row can actually be converted.
  const convertible = isConvertible(currency, target, rates);
  if (convertible) {
    for (const m of spec.measures) acc.sums[m.key] = (acc.sums[m.key] ?? 0) + convertAmount(values[m.key] ?? 0, currency, target, rates);
  } else {
    acc.excludedForFx += 1;
  }
  if (acc.tracker.add(currency)) {
    for (const m of spec.measures) acc.localSums[m.key] = (acc.localSums[m.key] ?? 0) + (values[m.key] ?? 0);
    acc.local = true;
  } else {
    acc.local = false; // a second currency showed up — a single local figure no longer applies
  }
}

/** Round the measures, derive the ratios from the RAW sums, and settle the local figure. */
function finalise(acc: WorkingRow, spec: ConsolidationSpec): ConsolidatedRow {
  const metrics: Record<string, number | null> = {};
  for (const m of spec.measures) metrics[m.key] = round2(acc.sums[m.key] ?? 0);
  // Derived metrics read the RAW (un-rounded) sums, matching the hand-written roll-ups they replace.
  for (const d of spec.derived) metrics[d.key] = applyDerived(d.op, acc.sums[d.a] ?? 0, acc.sums[d.b] ?? 0);
  return {
    key: acc.key,
    label: acc.label,
    projects: acc.projects,
    metrics,
    localCurrency: acc.tracker.currency,
    local: acc.local ? Object.fromEntries(spec.measures.map((m) => [m.key, round2(acc.localSums[m.key] ?? 0)])) : null,
    excludedForFx: acc.excludedForFx,
  };
}

/**
 * Run a consolidation spec over a set of project contributions: group them, fold each into its group + the
 * grand total, then finalise (round measures, compute derived, settle local) and sort. Ties on the sort key
 * always break on the group key, so the order is deterministic.
 */
export function consolidateByGroup(
  projects: ConsolidationInput[],
  spec: ConsolidationSpec,
  reportingCurrency: string,
  rates?: Record<string, number>,
): { groups: ConsolidatedRow[]; total: ConsolidatedRow } {
  const groups = new Map<string, WorkingRow>();
  const grand = blank(spec, "__portfolio__", "Portfolio");
  for (const p of projects) {
    const row = groups.get(p.groupKey) ?? blank(spec, p.groupKey, p.groupLabel);
    fold(row, p, spec, reportingCurrency, rates);
    groups.set(p.groupKey, row);
    fold(grand, p, spec, reportingCurrency, rates);
  }
  const sortKey = spec.sort.key;
  const dir = spec.sort.dir === "desc" ? -1 : 1;
  const rows = [...groups.values()].map((r) => finalise(r, spec)).sort((a, b) => {
    // A null metric (e.g. utilisation with no availability, CPI with no spend) sorts to the low end.
    const an = a.metrics[sortKey] ?? Number.NEGATIVE_INFINITY;
    const bn = b.metrics[sortKey] ?? Number.NEGATIVE_INFINITY;
    const cmp = an === bn ? 0 : dir * (an - bn);
    return cmp || a.key.localeCompare(b.key);
  });
  return { groups: rows, total: finalise(grand, spec) };
}

/**
 * Present a consolidated row as a FLAT record: the fixed fields plus every metric hoisted to a top-level
 * key. The generic shape any wire contract or table binds to — the field names are the spec's measure /
 * derived keys (data), never hardcoded here. Callers cast the result to their own named contract type.
 */
export function flattenRow(row: ConsolidatedRow): Record<string, unknown> {
  return { key: row.key, label: row.label, projects: row.projects, ...row.metrics, localCurrency: row.localCurrency, local: row.local, excludedForFx: row.excludedForFx };
}

/** The shipped consolidation specs, authored as JSON under assets/consolidations/ and embedded by
 *  gen-consolidations (drift-guarded), id-sorted for a stable order. */
export const CONSOLIDATIONS: ConsolidationSpec[] = [...CONSOLIDATIONS_DATA].sort((a, b) => a.id.localeCompare(b.id));

/** Look up a consolidation spec by id, or throw — a report binds to its spec by a stable id. */
export function consolidationSpec(id: string): ConsolidationSpec {
  const spec = CONSOLIDATIONS.find((c) => c.id === id);
  if (!spec) throw new Error(`Unknown consolidation spec "${id}" (known: ${CONSOLIDATIONS.map((c) => c.id).join(", ")})`);
  return spec;
}

/** The RAW row fields the named consolidation specs read — every measure's `field` and `weightField`,
 *  deduped, blanks dropped. A row sanitiser derives WHICH numeric fields to coerce from this instead of
 *  a hand-kept list, so adding a measure field to a spec automatically extends the sanitiser (no drift). */
export function consolidationFields(ids: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    for (const m of consolidationSpec(id).measures) {
      if (m.field) out.add(m.field);
      if (m.weightField) out.add(m.weightField);
    }
  }
  return [...out];
}
