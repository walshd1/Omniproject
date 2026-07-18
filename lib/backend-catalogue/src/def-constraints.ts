/**
 * DEF CONSTRAINTS — the declarative validation-rule layer of the composition model. A container def (a form, a
 * dashboard, any composed def) carries a `constraints[]`: rules over its child SET (cardinality, uniqueness, a
 * numeric bound) that a monolithic per-kind validator used to hardcode. Because they are data on the def, they
 * INHERIT down the composition tree like any other property, and are checked against the COMPOSED WHOLE (the
 * same choke point the ancestry/integrity check already uses).
 *
 * Two classes, with DIFFERENT merge algebra (this is the whole point):
 *   - POLICY  — child-wins. The nearest scope down the lineage replaces it; a descendant may relax OR tighten.
 *               "priority required", "description ≤ 500". An org copy may loosen these.
 *   - FLOOR   — conjoin, tighten-only. Introducible at ANY node, it binds that node's whole subtree and a
 *               descendant may only make it STRICTER, never looser (and never drop it). `exactlyOne(title)` is a
 *               floor because the issue model requires a title. To escape a floor you branch ABOVE the node that
 *               introduced it — you never relax it in place.
 *
 * PURE: fold the per-node constraint lists along a lineage (root → leaf) into the effective set (detecting any
 * attempt to relax a floor), then evaluate that set against the flattened def. No I/O.
 */

/** Whether a rule is a relax-able POLICY or a tighten-only FLOOR. */
export type ConstraintKind = "policy" | "floor";
/** The rule shapes this slice supports. `cardinality` counts child-set elements (optionally matching a
 *  predicate) into a [min,max]; `bound` holds a numeric field within [min,max]. */
export type ConstraintType = "cardinality" | "bound";

export interface DefConstraint {
  /** Stable id — overrides + floor-conjoin merge BY this id along the lineage. */
  id: string;
  kind: ConstraintKind;
  type: ConstraintType;
  /** Dot-path into the def the rule reads (`"fields"`, `"widgets"`, `"value"`, `"a.b"`). */
  path: string;
  /** cardinality only — count just the elements whose `field` equals `eq` (e.g. the one bound to `title`). */
  where?: { field: string; eq: unknown };
  /** cardinality: min/max COUNT. bound: min/max VALUE. Either bound may be omitted (that side is unbounded). */
  min?: number;
  max?: number;
  /** Optional human message used verbatim when the rule fails. */
  message?: string;
}

const CONSTRAINT_KINDS = new Set<string>(["policy", "floor"]);
const CONSTRAINT_TYPES = new Set<string>(["cardinality", "bound"]);
const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Coerce one untrusted payload entry into a {@link DefConstraint}, or null if it isn't a well-formed rule (so a
 *  def that happens to carry an unrelated `constraints`-named field is ignored, never half-applied). */
export function coerceConstraint(raw: unknown): DefConstraint | null {
  if (!isRec(raw)) return null;
  const id = raw["id"], kind = raw["kind"], type = raw["type"], path = raw["path"];
  if (typeof id !== "string" || !id.trim()) return null;
  if (typeof kind !== "string" || !CONSTRAINT_KINDS.has(kind)) return null;
  if (typeof type !== "string" || !CONSTRAINT_TYPES.has(type)) return null;
  if (typeof path !== "string" || !path.trim()) return null;
  const c: DefConstraint = { id, kind: kind as ConstraintKind, type: type as ConstraintType, path };
  if (isNum(raw["min"])) c.min = raw["min"];
  if (isNum(raw["max"])) c.max = raw["max"];
  if (isRec(raw["where"]) && typeof raw["where"]["field"] === "string") c.where = { field: raw["where"]["field"], eq: raw["where"]["eq"] };
  if (typeof raw["message"] === "string") c.message = raw["message"];
  return c;
}

/** Read a dot-path out of a def payload (top-level or nested). Undefined when any segment is missing. */
function getPath(def: Record<string, unknown>, path: string): unknown {
  let cur: unknown = def;
  for (const seg of path.split(".")) {
    if (!isRec(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * Fold a lineage's per-node constraint lists (ordered ROOT → LEAF) into the effective set. Policy rules are
 * child-wins (nearest overwrites by id). Floor rules CONJOIN by id: a descendant may tighten (raise a min, lower
 * a max) but any attempt to RELAX one — loosen a bound, drop it to policy, or retarget it — is an error (you
 * must branch above the node that introduced it instead). Returns the effective set plus any relax errors.
 */
export function foldConstraints(perNodeRootToLeaf: unknown[][]): { effective: DefConstraint[]; errors: string[] } {
  const byId = new Map<string, DefConstraint>();
  const errors: string[] = [];
  for (const node of perNodeRootToLeaf) {
    for (const raw of node) {
      const c = coerceConstraint(raw);
      if (!c) continue;
      const prior = byId.get(c.id);
      if (!prior || prior.kind !== "floor") { byId.set(c.id, c); continue; } // new, or overriding a policy → take it
      // prior is a FLOOR introduced by an ancestor — the descendant may only tighten it.
      if (c.kind !== "floor") { errors.push(`cannot relax floor "${c.id}" to policy — it is introduced by an ancestor; branch above that node instead`); continue; }
      if (c.type !== prior.type || c.path !== prior.path) { errors.push(`cannot redefine floor "${c.id}" (its ancestor targets ${prior.type} "${prior.path}")`); continue; }
      const merged: DefConstraint = { ...prior };
      if (c.max !== undefined) {
        if (prior.max !== undefined && c.max > prior.max) errors.push(`cannot relax floor "${c.id}": an ancestor caps "${prior.path}" at ${prior.max}; branch above where it is introduced`);
        else merged.max = prior.max !== undefined ? Math.min(prior.max, c.max) : c.max;
      }
      if (c.min !== undefined) {
        if (prior.min !== undefined && c.min < prior.min) errors.push(`cannot relax floor "${c.id}": an ancestor requires "${prior.path}" ≥ ${prior.min}; branch above where it is introduced`);
        else merged.min = prior.min !== undefined ? Math.max(prior.min, c.min) : c.min;
      }
      byId.set(c.id, merged);
    }
  }
  return { effective: [...byId.values()], errors };
}

/** Evaluate the effective constraint set against a flattened def. Returns one message per violated rule. */
export function evaluateConstraints(def: Record<string, unknown>, constraints: DefConstraint[]): string[] {
  const errors: string[] = [];
  for (const c of constraints) {
    if (c.type === "cardinality") {
      const raw = getPath(def, c.path);
      const list = Array.isArray(raw) ? raw : [];
      const count = c.where ? list.filter((el) => isRec(el) && el[c.where!.field] === c.where!.eq).length : list.length;
      const label = c.where ? `"${c.path}" entries where ${c.where.field}=${JSON.stringify(c.where.eq)}` : `"${c.path}"`;
      if (c.min !== undefined && count < c.min) errors.push(c.message ?? `${label} must number at least ${c.min} (has ${count})`);
      if (c.max !== undefined && count > c.max) errors.push(c.message ?? `${label} must number at most ${c.max} (has ${count})`);
    } else {
      const v = getPath(def, c.path);
      if (!isNum(v)) { errors.push(c.message ?? `"${c.path}" must be a number to satisfy constraint "${c.id}"`); continue; }
      if (c.min !== undefined && v < c.min) errors.push(c.message ?? `"${c.path}" must be ≥ ${c.min} (is ${v})`);
      if (c.max !== undefined && v > c.max) errors.push(c.message ?? `"${c.path}" must be ≤ ${c.max} (is ${v})`);
    }
  }
  return errors;
}

/**
 * The one call the composed-whole validator makes: given the flattened def and its lineage's per-node constraint
 * lists (root → leaf), return every reason the def fails — a relaxed floor OR a violated effective rule. Empty
 * when the def carries no constraints anywhere in its lineage (so a def without constraints is untouched).
 */
export function composedConstraintErrors(def: Record<string, unknown>, perNodeRootToLeaf: unknown[][]): string[] {
  const { effective, errors } = foldConstraints(perNodeRootToLeaf);
  return [...errors, ...evaluateConstraints(def, effective)];
}
