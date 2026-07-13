/**
 * Column → canonical-field mapper. PURE logic (no I/O), so it is fully unit-tested
 * and reused by any tabular importer (Excel, CSV, a SQL/Mongo result set).
 *
 * Given a list of source column headers, it SUGGESTS a mapping onto the canonical
 * FIELD_REGISTRY by:
 *   1. exact match on a field's key or label (confidence 1.0),
 *   2. a curated synonym (0.9) — the common header aliases real spreadsheets use,
 *   3. fuzzy similarity on normalised tokens (≤ 0.85).
 * Each canonical field is claimed by at most ONE column (the highest-confidence
 * one); the rest fall through as "unmapped" so nothing is silently dropped — an
 * operator confirms/edits the mapping before any import (reference mapping, not law).
 */
import { FIELD_REGISTRY, type FieldDescriptor, type FieldType } from "./field-registry";
import { isForbiddenKey } from "./safe-json";

/** Common spreadsheet header aliases → canonical field key. Lower-cased, normalised. */
const SYNONYMS: Record<string, string> = {
  summary: "title",
  name: "title",
  subject: "title",
  task: "title",
  details: "description",
  notes: "description",
  owner: "assignee",
  assignedto: "assignee",
  responsible: "assignee",
  raisedby: "reporter",
  createdby: "reporter",
  state: "status",
  stage: "status",
  deadline: "dueDate",
  duedate: "dueDate",
  enddate: "dueDate",
  finish: "dueDate",
  finishdate: "dueDate",
  begin: "startDate",
  start: "startDate",
  est: "estimateHours",
  estimate: "estimateHours",
  effort: "estimateHours",
  points: "storyPoints",
  storypoints: "storyPoints",
  sp: "storyPoints",
  // `tags` is now a canonical field in its own right (exact-matches ahead of this table);
  // `category` still folds onto labels for backends that don't separate the two.
  category: "labels",
  cost: "actualCost",
  spend: "actualCost",
  budgeted: "budget",
  costcentre: "costCenter",
  costcenter: "costCenter",
  parent: "parentTask",
  epiclink: "epic",
  prio: "priority",
};

export interface ColumnSuggestion {
  /** The source column header, verbatim. */
  column: string;
  /** The canonical field key it maps to, or null when nothing matched. */
  suggestedField: string | null;
  /** The canonical field's value type (for coercion / UI), null when unmapped. */
  type: FieldType | null;
  /** 0..1 — how confident the suggestion is (1 = exact). */
  confidence: number;
  /** How the match was found, for transparency in the UI. */
  basis: "exact" | "synonym" | "fuzzy" | "none";
}

/** Normalise a header/key for comparison: lower-case, drop all non-alphanumerics. */
export function normaliseHeader(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Dice coefficient on character bigrams — a cheap, dependency-free fuzzy score. */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  let overlap = 0;
  for (const [g, n] of A) overlap += Math.min(n, B.get(g) ?? 0);
  const total = a.length - 1 + (b.length - 1);
  return (2 * overlap) / total;
}

/** Score a single header against the registry; returns the best candidate. */
function scoreHeader(column: string, registry: FieldDescriptor[]): ColumnSuggestion {
  const norm = normaliseHeader(column);
  if (!norm) return { column, suggestedField: null, type: null, confidence: 0, basis: "none" };

  // 1. Exact key/label match.
  for (const f of registry) {
    if (normaliseHeader(f.key) === norm || normaliseHeader(f.label) === norm) {
      return { column, suggestedField: f.key, type: f.type, confidence: 1, basis: "exact" };
    }
  }
  // 2. Curated synonym.
  const syn = SYNONYMS[norm];
  if (syn) {
    const f = registry.find((r) => r.key === syn);
    if (f) return { column, suggestedField: f.key, type: f.type, confidence: 0.9, basis: "synonym" };
  }
  // 3. Fuzzy — best similarity over key + label, capped below the curated tiers.
  let best: { f: FieldDescriptor; score: number } | null = null;
  for (const f of registry) {
    const score = Math.max(similarity(norm, normaliseHeader(f.key)), similarity(norm, normaliseHeader(f.label)));
    if (!best || score > best.score) best = { f, score };
  }
  if (best && best.score >= 0.6) {
    return { column, suggestedField: best.f.key, type: best.f.type, confidence: Math.min(0.85, best.score), basis: "fuzzy" };
  }
  return { column, suggestedField: null, type: null, confidence: 0, basis: "none" };
}

/**
 * Suggest a column→field mapping for a set of headers. Each canonical field is
 * claimed by at most one column (highest confidence wins); losers are downgraded
 * to unmapped so a human resolves the clash deliberately.
 */
export function suggestColumnMapping(headers: string[], registry: FieldDescriptor[] = FIELD_REGISTRY): ColumnSuggestion[] {
  const scored = headers.map((h) => scoreHeader(h, registry));
  // Resolve collisions: if two columns claim the same field, keep the most
  // confident; demote the rest to unmapped.
  const claimed = new Map<string, number>(); // field key → index of current winner
  scored.forEach((s, i) => {
    if (!s.suggestedField) return;
    const prev = claimed.get(s.suggestedField);
    if (prev === undefined) {
      claimed.set(s.suggestedField, i);
      return;
    }
    const winner = scored[prev]!.confidence >= s.confidence ? prev : i;
    const loser = winner === prev ? i : prev;
    claimed.set(s.suggestedField, winner);
    scored[loser] = { ...scored[loser]!, suggestedField: null, type: null, confidence: 0, basis: "none" };
  });
  return scored;
}

// Per-type coercers — each is best-effort + lossless (returns the raw value when it
// can't parse). Numeric types share one. Registered below so adding a type's
// coercion is one entry, not a switch arm.
const toNumber = (raw: unknown): unknown => {
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[, %£$€]/g, ""));
  return Number.isNaN(n) ? raw : n;
};
const toBoolean = (raw: unknown): unknown => {
  const s = String(raw).toLowerCase();
  if (["true", "yes", "y", "1"].includes(s)) return true;
  if (["false", "no", "n", "0"].includes(s)) return false;
  return raw;
};
const toDate = (raw: unknown): unknown => {
  const d = raw instanceof Date ? raw : new Date(String(raw));
  return Number.isNaN(d.getTime()) ? raw : d.toISOString().slice(0, 10);
};
const toLabels = (raw: unknown): unknown => {
  if (Array.isArray(raw)) return raw;
  return String(raw).split(/[;,]/).map((s) => s.trim()).filter(Boolean);
};

/** Registry: canonical field type → its value coercer (absent = passthrough). */
const COERCERS: Partial<Record<FieldType, (raw: unknown) => unknown>> = {
  number: toNumber,
  currency: toNumber,
  percent: toNumber,
  duration: toNumber,
  boolean: toBoolean,
  date: toDate,
  labels: toLabels,
};

/** Coerce a raw cell value to the canonical field's type. Best-effort + lossless
 *  when it can't (returns the trimmed string), so a preview never silently nulls. */
export function coerceValue(value: unknown, type: FieldType): unknown {
  if (value == null || value === "") return null;
  const raw = typeof value === "string" ? value.trim() : value;
  const coerce = COERCERS[type];
  return coerce ? coerce(raw) : raw;
}

export interface MappingEntry {
  column: string;
  field: string;
  type: FieldType;
}

/**
 * Apply a confirmed mapping to raw rows, producing canonical payloads. Only mapped
 * columns are carried (unmapped columns are dropped — they would otherwise become
 * stray custom fields); values are coerced by field type. Pure: no writes happen
 * here — the caller decides whether/how to persist via the broker.
 */
export function applyColumnMapping(rows: Record<string, unknown>[], mapping: MappingEntry[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const m of mapping) {
      if (!(m.column in row)) continue;
      const v = coerceValue(row[m.column], m.type);
      // m.field is a caller-supplied string inside the import `mapping[]` (a body VALUE, so the global
      // body reviver doesn't clean it). Skip a prototype-pollution key rather than assign `out["__proto__"]`.
      if (v !== null && !isForbiddenKey(m.field)) out[m.field] = v;
    }
    return out;
  });
}

/** Derive the confirmed-mapping list from suggestions (drops the unmapped ones). */
export function mappingFromSuggestions(suggestions: ColumnSuggestion[]): MappingEntry[] {
  return suggestions
    .filter((s): s is ColumnSuggestion & { suggestedField: string; type: FieldType } => s.suggestedField !== null && s.type !== null)
    .map((s) => ({ column: s.column, field: s.suggestedField, type: s.type }));
}
