/**
 * Conditional predicate engine — the pure "when" of the PMO rule plane.
 *
 * A rule fires when its conditions hold against a context of project facts (programme, project type,
 * budget, projection, intra-company, …). The same engine drives BOTH planes of effect:
 *   - **governance** — apply/relax a ruleset for *some or all* project types (small internal projects
 *     need lighter control), and
 *   - **costing** — pick the costing model / margin for a context ("cost + margin, unless the order is
 *     intra-company").
 *
 * It's the matrix the PMO described: "this applies to projects in this programme, of this type, whose
 * budget > X and whose projection is negative". This module is pure and side-effect free, so the whole
 * predicate language is unit-testable in isolation; callers build the context and attach effects.
 */

/**
 * Comparison operators. Binary ops compare the context field to `value`; unary ops (`truthy`/`falsy`/
 * `negative`/`nonNegative`) ignore `value`. Numeric ops coerce both sides to a finite number and are
 * false when either side isn't numeric (so a missing field never accidentally satisfies `> 0`).
 */
export type Op = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "nin" | "truthy" | "falsy" | "negative" | "nonNegative";

export interface Predicate {
  /** A key into the evaluation context (e.g. "projectType", "budget", "projection", "intraCompany"). */
  field: string;
  op: Op;
  /** The comparand for binary ops; omitted for unary ops. For `in`/`nin` it's an array. */
  value?: unknown;
}

/**
 * A condition set. The rule matches when **every** predicate in `all` holds AND (if `any` is non-empty)
 * **at least one** predicate in `any` holds. An empty/absent condition set matches everything (a rule
 * with no `when` applies universally).
 */
export interface ConditionSet {
  all?: Predicate[];
  any?: Predicate[];
}

export type Context = Record<string, unknown>;

const asNum = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Evaluate one predicate against the context. Unknown ops are conservatively false. */
export function evaluatePredicate(p: Predicate, ctx: Context): boolean {
  const actual = ctx[p.field];
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
      const a = asNum(actual), b = asNum(p.value);
      if (a === null || b === null) return false;
      return p.op === "gt" ? a > b : p.op === "gte" ? a >= b : p.op === "lt" ? a < b : a <= b;
    }
    default:
      // Exhaustiveness poka-yoke: every `Op` is handled above, so `p.op` is `never` here — adding a
      // new operator to the union without a case fails to COMPILE at this line. At runtime `satisfies`
      // is erased, so an unvalidated/unknown op still degrades to conservatively-false (a malformed
      // stored rule must never throw and 500 a feature-gated read).
      p.op satisfies never;
      return false;
  }
}

/** Does this condition set match the context? (all-of `all` AND any-of `any`; empty ⇒ matches all.) */
export function matches(cond: ConditionSet | undefined, ctx: Context): boolean {
  if (!cond) return true;
  // Defensive: a malformed stored `when` (e.g. `all` as an object, not an array) must degrade to
  // "no constraint", never throw — a thrown TypeError here 500s every feature-gated read.
  const all = Array.isArray(cond.all) ? cond.all : [];
  const any = Array.isArray(cond.any) ? cond.any : [];
  if (!all.every((p) => evaluatePredicate(p, ctx))) return false;
  if (any.length > 0 && !any.some((p) => evaluatePredicate(p, ctx))) return false;
  return true;
}

/**
 * From a list of conditioned items, the ones whose condition matches the context, **in declared order**.
 * Effect resolution (last-match-wins, first-match-wins, collect-all) is the caller's policy — this just
 * filters by the matrix.
 */
export function selectMatching<T extends { when?: ConditionSet }>(items: readonly T[], ctx: Context): T[] {
  return items.filter((it) => matches(it.when, ctx));
}

/** Validate a predicate's shape (used at the rule-authoring boundary). Returns an error string or null. */
export function validatePredicate(p: unknown): string | null {
  if (!p || typeof p !== "object") return "predicate must be an object";
  const o = p as Record<string, unknown>;
  if (typeof o["field"] !== "string" || !o["field"]) return "predicate.field must be a non-empty string";
  const ops: Op[] = ["eq", "ne", "gt", "gte", "lt", "lte", "in", "nin", "truthy", "falsy", "negative", "nonNegative"];
  if (!ops.includes(o["op"] as Op)) return `predicate.op must be one of ${ops.join(", ")}`;
  if ((o["op"] === "in" || o["op"] === "nin") && !Array.isArray(o["value"])) return `predicate.op "${String(o["op"])}" needs an array value`;
  return null;
}
