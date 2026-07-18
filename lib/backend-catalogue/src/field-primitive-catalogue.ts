import { FORM_FIELD_TYPES, ISSUE_WRITE_TARGETS } from "./form-catalogue";
import { evaluateConstraints, type DefConstraint } from "./def-constraints";

/**
 * FIELD PRIMITIVES — `field` is a ROOT primitive (sibling to `table` / `bar`). Per the model, a root is the MOST
 * PERMISSIVE shape possible and is NEVER used raw: it holds only what is universal to any input (an identity +
 * a label + a type) and imposes no restrictive floors. The restrictions arrive in specialisations:
 *
 *   field (root, abstract, permissive)
 *     └─ form-field (abstract) — a field BOUND INTO A FORM: adds `mapTo` and the security FLOOR that it be a
 *          writable issue field. This is where "an issue needs a real target" lives — it is a property of using
 *          a field to write an issue, not of field-ness, so it is NOT on the permissive root.
 *          └─ text / select / date / … (concrete) — each adds only its type specifics (a choice needs options).
 *
 * Only the concrete leaves are ever instantiated (a form field's `type` is `text`/`select`/…); the two abstract
 * ancestors can never be used raw (`validateFieldInstance` rejects them). The leaf type ids are DERIVED from
 * `FORM_FIELD_TYPES` (the one source the SPA field family also uses), so they can't drift from the accepted set.
 */

export interface FieldParam { key: string; required?: boolean }
export interface FieldPrimitive {
  /** `field` (root) / `form-field` (intermediate) / a concrete type id (`text`, `select`, …). */
  id: string;
  /** The parent this primitive extends (root has none). */
  extends?: string;
  /** Abstract primitives are NEVER used raw — only their concrete descendants are instantiated. */
  abstract?: boolean;
  label: string;
  /** The field's configuration properties (marked `required` where a field must carry them). */
  params: FieldParam[];
  /** Declared validation for a field at this level (evaluated against the field instance). */
  constraints?: DefConstraint[];
}

const titleCase = (s: string): string => s.replace(/(^|[-_])(\w)/g, (_m, _p, c: string) => (_p ? " " : "") + c.toUpperCase());

/** ROOT — the most permissive shape: identity + label + type + the common optional config. No floors. */
const FIELD_ROOT: FieldPrimitive = {
  id: "field",
  label: "Field",
  abstract: true,
  params: [
    { key: "key", required: true },
    { key: "label", required: true },
    { key: "type", required: true },
    { key: "required" }, { key: "help" }, { key: "placeholder" }, { key: "maxLength" },
  ],
};

/** INTERMEDIATE — a field bound into a form: adds `mapTo` and the writable-issue-field FLOOR (the security
 *  allow-list) plus the positive-`maxLength` policy. Abstract; concrete field types extend THIS. */
const FORM_FIELD: FieldPrimitive = {
  id: "form-field",
  extends: "field",
  label: "Form field",
  abstract: true,
  params: [{ key: "mapTo", required: true }],
  constraints: [
    { id: "form-field-target", kind: "floor", type: "enum", path: "mapTo", values: [...ISSUE_WRITE_TARGETS], message: "a field must map to a writable issue field" },
    { id: "form-field-maxlength", kind: "policy", type: "bound", path: "maxLength", min: 1, message: "maxLength must be a positive number" },
  ],
};

/** Types offering a fixed choice set need `options` (likert DEFAULTS its scale, so its options aren't required). */
const CHOICE_TYPES = new Set(["select", "radio", "multiselect", "likert"]);

function childFor(type: string): FieldPrimitive {
  const params: FieldParam[] = [];
  const constraints: DefConstraint[] = [];
  if (CHOICE_TYPES.has(type)) {
    const optionsRequired = type !== "likert";
    params.push({ key: "options", required: optionsRequired });
    if (optionsRequired) constraints.push({ id: `${type}-options`, kind: "floor", type: "cardinality", path: "options", min: 1, message: `a ${type} field needs at least one option` });
  }
  return { id: type, extends: "form-field", label: titleCase(type), params, ...(constraints.length ? { constraints } : {}) };
}

const FIELD_PRIMITIVES: FieldPrimitive[] = [FIELD_ROOT, FORM_FIELD, ...FORM_FIELD_TYPES.map(childFor)];
const byId = new Map(FIELD_PRIMITIVES.map((p) => [p.id, p]));

/** The field primitives (root + intermediate + one per form-field type). A fresh array each call. */
export function fieldPrimitiveCatalogue(): FieldPrimitive[] {
  return FIELD_PRIMITIVES.map((p) => ({ ...p, params: p.params.map((x) => ({ ...x })), ...(p.constraints ? { constraints: p.constraints.map((c) => ({ ...c })) } : {}) }));
}

/** One field primitive by id, or undefined. */
export function fieldPrimitive(id: string): FieldPrimitive | undefined { return byId.get(id); }

/** Walk a field type's extends chain (leaf → root), throwing on a broken chain. */
function chainOf(type: string): FieldPrimitive[] {
  const chain: FieldPrimitive[] = [];
  let cur = byId.get(type);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push(cur);
    cur = cur.extends ? byId.get(cur.extends) : undefined;
  }
  return chain;
}

/** The effective constraints for a concrete field type — every ancestor's, composed. */
function effectiveFieldConstraints(type: string): DefConstraint[] {
  return chainOf(type).flatMap((p) => p.constraints ?? []);
}

/** The required config keys a concrete field of `type` must carry (all ancestors' required params). */
function requiredParams(type: string): string[] {
  return chainOf(type).flatMap((p) => p.params).filter((p) => p.required).map((p) => p.key);
}

/** Validate ONE form-field instance against its field primitive — the type is a concrete (never an abstract
 *  ancestor used raw), its required params are present, and it satisfies the composed constraints (incl. the
 *  inherited `mapTo` allow-list floor from `form-field`). */
export function validateFieldInstance(field: Record<string, unknown>): string[] {
  const type = typeof field["type"] === "string" ? field["type"] : "";
  const label = (typeof field["label"] === "string" && field["label"]) ? field["label"] : (typeof field["key"] === "string" && field["key"] ? field["key"] : "a field");
  const prim = byId.get(type);
  if (!prim || prim.abstract) return [`"${label}" has an unknown field type "${type}"`]; // a root/abstract may never be used raw
  const errors: string[] = [];
  for (const key of requiredParams(type)) {
    const v = field[key];
    const present = v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "") && !(Array.isArray(v) && v.length === 0);
    if (!present) errors.push(`"${label}" is missing required "${key}"`);
  }
  errors.push(...evaluateConstraints(field, effectiveFieldConstraints(type)));
  return errors;
}

/** Validate a form's `fields[]` as field-primitive instances (the per-element half of form validation). Empty
 *  when `fields` isn't an array — the container `min-fields` floor already reports a missing/empty field set. */
export function validateFormFields(fields: unknown): string[] {
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((f) => (f && typeof f === "object" && !Array.isArray(f)) ? validateFieldInstance(f as Record<string, unknown>) : ["a field must be an object"]);
}
