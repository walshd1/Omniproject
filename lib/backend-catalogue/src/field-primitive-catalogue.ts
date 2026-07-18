import { FORM_FIELD_TYPES, ISSUE_WRITE_TARGETS } from "./form-catalogue";
import { evaluateConstraints, type DefConstraint } from "./def-constraints";

/**
 * FIELD PRIMITIVES — `field` is a ROOT primitive (sibling to `table` / `bar`), and every form-input type is a
 * thin CHILD that extends it (text ← field, select ← field, …). The root holds the common field contract as
 * params (`key`/`label`/`type`/`mapTo`/…) and, crucially, the security-relevant rule as a declared FLOOR: a
 * field's `mapTo` must be a WRITABLE issue field. Being a floor on the root, it is inherited by every field type
 * and can't be relaxed by a fork — the allow-list moves off the monolithic form validator onto the primitive,
 * where the composition model wants it. Each concrete type adds only what's new (a choice type needs `options`;
 * a text-ish type may cap `maxLength`).
 *
 * The type ids are DERIVED from `FORM_FIELD_TYPES` (the one source the SPA `field` family also draws from), so
 * this can never drift from the accepted set. Per-field validation (`validateFormFields`) resolves each form
 * field to its primitive and checks the field instance against that primitive's required params + constraints —
 * the "each child is a primitive instance validated against its primitive" rule, run on the composed/resolved
 * form at import AND submission.
 */

export interface FieldParam { key: string; required?: boolean }
export interface FieldPrimitive {
  /** `field` (root) or a form-field type id (`text`, `select`, …). */
  id: string;
  /** Children extend the root `field`. */
  extends?: string;
  label: string;
  /** The field's configuration properties (marked `required` where the field must carry them). */
  params: FieldParam[];
  /** Declared validation for a field of this type (evaluated against the field instance). */
  constraints?: DefConstraint[];
}

const titleCase = (s: string): string => s.replace(/(^|[-_])(\w)/g, (_m, _p, c: string) => (_p ? " " : "") + c.toUpperCase());

/** The ROOT: the common contract + the `mapTo` allow-list floor + the (any-field) optional `maxLength` bound. */
const FIELD_ROOT: FieldPrimitive = {
  id: "field",
  label: "Form field",
  params: [
    { key: "key", required: true },
    { key: "label", required: true },
    { key: "type", required: true },
    { key: "mapTo", required: true },
    { key: "required" }, { key: "help" }, { key: "placeholder" }, { key: "maxLength" },
  ],
  constraints: [
    { id: "field-map-target", kind: "floor", type: "enum", path: "mapTo", values: [...ISSUE_WRITE_TARGETS], message: "a field must map to a writable issue field" },
    { id: "field-maxlength", kind: "policy", type: "bound", path: "maxLength", min: 1, message: "maxLength must be a positive number" },
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
  return { id: type, extends: "field", label: titleCase(type), params, ...(constraints.length ? { constraints } : {}) };
}

const FIELD_PRIMITIVES: FieldPrimitive[] = [FIELD_ROOT, ...FORM_FIELD_TYPES.map(childFor)];
const byId = new Map(FIELD_PRIMITIVES.map((p) => [p.id, p]));

/** The field primitives (root + one per form-field type). A fresh array so a caller can't mutate the catalogue. */
export function fieldPrimitiveCatalogue(): FieldPrimitive[] {
  return FIELD_PRIMITIVES.map((p) => ({ ...p, params: p.params.map((x) => ({ ...x })), ...(p.constraints ? { constraints: p.constraints.map((c) => ({ ...c })) } : {}) }));
}

/** One field primitive (root or a type), or undefined. */
export function fieldPrimitive(type: string): FieldPrimitive | undefined { return byId.get(type); }

/** The effective constraints for a field type — the root's inherited floors PLUS the type's own. */
function effectiveFieldConstraints(type: string): DefConstraint[] {
  const child = byId.get(type);
  const root = FIELD_ROOT.constraints ?? [];
  return child && child.id !== "field" ? [...root, ...(child.constraints ?? [])] : [...root];
}

/** The required config keys a field of `type` must carry (root's required params + the type's). */
function requiredParams(type: string): string[] {
  const child = byId.get(type);
  const params = child && child.id !== "field" ? [...FIELD_ROOT.params, ...child.params] : FIELD_ROOT.params;
  return params.filter((p) => p.required).map((p) => p.key);
}

/** Validate ONE form-field instance against its field primitive — the type is known, its required params are
 *  present, and it satisfies the primitive's constraints (incl. the inherited `mapTo` allow-list floor). */
export function validateFieldInstance(field: Record<string, unknown>): string[] {
  const type = typeof field["type"] === "string" ? field["type"] : "";
  const label = (typeof field["label"] === "string" && field["label"]) ? field["label"] : (typeof field["key"] === "string" && field["key"] ? field["key"] : "a field");
  if (!byId.has(type) || type === "field") return [`"${label}" has an unknown field type "${type}"`];
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
