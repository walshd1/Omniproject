/**
 * Conditional predicate engine — the shared "when" language of every OmniProject rule plane.
 *
 * A rule fires when its conditions hold against a context of facts. The SAME pure engine drives every
 * conditional plane, so there is exactly one condition language across the product:
 *   - **governance** — apply/relax a ruleset for some or all project types,
 *   - **costing** — pick the costing model / margin for a context,
 *   - **automation / rules** — the "IF" of a trigger→action rule, evaluated against the event subject.
 *
 * It's the matrix the PMO described: "this applies to projects in this programme, of this type, whose
 * budget > X and whose projection is negative". This module is pure and side-effect free (zero runtime
 * dependencies), so it lives in the shared catalogue and the whole predicate language is unit-testable in
 * isolation; callers build the context and attach effects.
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

/**
 * Normalise a validated condition set (drops malformed predicates rather than throwing) — the shape the
 * dispatcher/evaluator can trust. Used by the automation/rules layer when compiling a stored rule's `when`
 * (or a legacy flat condition list converted to a `ConditionSet`) so evaluation never sees a bad predicate.
 */
export function cleanConditionSet(value: unknown): ConditionSet {
  const o = (value ?? {}) as Record<string, unknown>;
  const clean = (arr: unknown): Predicate[] =>
    (Array.isArray(arr) ? arr : []).filter((p): p is Predicate => validatePredicate(p) === null);
  const all = clean(o["all"]);
  const any = clean(o["any"]);
  const out: ConditionSet = {};
  if (all.length) out.all = all;
  if (any.length) out.any = any;
  return out;
}
