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
import { convertAmount, isConvertible, LocalTracker } from "./finance-consolidation";
import { CONSOLIDATIONS_DATA } from "./consolidations.generated";

/** Coerce a possibly-dirty numeric value to a finite number (string/null/NaN/±Infinity → 0). */
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The closed set of derived-metric operations a consolidation spec may name. */
export type DerivedOp =
  | "diff" // a − b (e.g. budget − forecast = variance)
  | "diffFloor0" // max(0, a − b) (e.g. projected − invoiced = unbilled, clamped)
  | "ratioPct" // b>0 ? a/b×100 (1dp) : 0 (e.g. invoiced/projected = billed %)
  | "ratioOrNull"; // b>0 ? a/b (2dp) : null (e.g. earnedValue/actual = CPI)

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
  /** The measure keys to accumulate (each summed across a group's projects, then FX-converted). */
  measures: string[];
  /** Derived metrics computed from the RAW (un-rounded) measure sums at finalise. */
  derived: DerivedMetric[];
  /** Row ordering. */
  sort: ConsolidationSort;
}

/** One project's contribution to a consolidation: its group, its currency, and its measure values. */
export interface ConsolidationInput {
  /** Grouping key (e.g. a programmeId, or a "standalone" sentinel). */
  groupKey: string;
  /** Human label for the group. */
  groupLabel: string;
  /** The project's source currency (drives FX conversion + local-currency tracking). */
  currency: string;
  /** Raw per-measure amounts, keyed by the spec's measure keys (already extracted from the read model). */
  values: Record<string, number>;
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
    case "ratioOrNull":
      return b > 0 ? round2(a / b) : null;
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
  const zero = () => Object.fromEntries(spec.measures.map((m) => [m, 0]));
  return { key, label, projects: 0, sums: zero(), localSums: zero(), local: false, tracker: new LocalTracker(), excludedForFx: 0 };
}

/** Fold one project into a row: FX-convert its measures into the total (gated on convertibility), and
 *  accumulate the raw amounts as the row's local figure for as long as one currency is shared. */
function fold(acc: WorkingRow, p: ConsolidationInput, spec: ConsolidationSpec, target: string, rates?: Record<string, number>): void {
  acc.projects += 1;
  const currency = String(p.currency ?? "");
  // convertAmount passes an amount through UNCHANGED when a rate is missing, so a raw foreign amount
  // would corrupt the consolidated total — only fold measures in when the row can actually be converted.
  const convertible = isConvertible(currency, target, rates);
  if (convertible) {
    for (const m of spec.measures) acc.sums[m] = (acc.sums[m] ?? 0) + convertAmount(num(p.values[m]), currency, target, rates);
  } else {
    acc.excludedForFx += 1;
  }
  if (acc.tracker.add(currency)) {
    for (const m of spec.measures) acc.localSums[m] = (acc.localSums[m] ?? 0) + num(p.values[m]);
    acc.local = true;
  } else {
    acc.local = false; // a second currency showed up — a single local figure no longer applies
  }
}

/** Round the measures, derive the ratios from the RAW sums, and settle the local figure. */
function finalise(acc: WorkingRow, spec: ConsolidationSpec): ConsolidatedRow {
  const metrics: Record<string, number | null> = {};
  for (const m of spec.measures) metrics[m] = round2(acc.sums[m] ?? 0);
  // Derived metrics read the RAW (un-rounded) sums, matching the hand-written roll-ups they replace.
  for (const d of spec.derived) metrics[d.key] = applyDerived(d.op, acc.sums[d.a] ?? 0, acc.sums[d.b] ?? 0);
  return {
    key: acc.key,
    label: acc.label,
    projects: acc.projects,
    metrics,
    localCurrency: acc.tracker.currency,
    local: acc.local ? Object.fromEntries(spec.measures.map((m) => [m, round2(acc.localSums[m] ?? 0)])) : null,
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
    const av = a.metrics[sortKey] ?? 0;
    const bv = b.metrics[sortKey] ?? 0;
    return dir * (av - bv) || a.key.localeCompare(b.key);
  });
  return { groups: rows, total: finalise(grand, spec) };
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
