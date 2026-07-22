import { evaluateConstraints, type DefConstraint } from "./def-constraints";
import { assertFieldHasPolicy, type FieldValidation, type SanitisePolicy } from "./field-validation";
// DERIVED field primitives — everything that COMPOSES from the `field` root (`extends`) is DATA, authored as
// JSON recipes under field-primitives/ (the same rule the visual primitives, screens, reports and mappings
// follow). Only the `field` ROOT below stays in TypeScript. `form-field` (the intermediate) and every concrete
// type (text/select/…) is a recipe carrying its added params + constraints — including form-field's `mapTo`
// writable-issue-field allow-list, which is DATA (the enforcement, `validateFieldInstance`, stays code).
import formField from "./field-primitives/form-field.json";
import textField from "./field-primitives/text.json";
import textareaField from "./field-primitives/textarea.json";
import numberField from "./field-primitives/number.json";
import dateField from "./field-primitives/date.json";
import emailField from "./field-primitives/email.json";
import urlField from "./field-primitives/url.json";
import selectField from "./field-primitives/select.json";
import radioField from "./field-primitives/radio.json";
import likertField from "./field-primitives/likert.json";
import multiselectField from "./field-primitives/multiselect.json";
import checkboxField from "./field-primitives/checkbox.json";
import yesnoField from "./field-primitives/yesno.json";
import addressField from "./field-primitives/address.json";

/**
 * FIELD PRIMITIVES — `field` is a ROOT primitive (sibling to `table` / `bar`). Per the model, a root is the MOST
 * PERMISSIVE shape possible and is NEVER used raw: it holds only what is universal to any input (an identity +
 * a label + a type) and imposes no restrictive floors. The restrictions arrive in specialisations:
 *
 *   field (root, abstract, permissive)              ← TypeScript (a root)
 *     └─ form-field (abstract) — a field BOUND INTO A FORM: adds `mapTo` and the security FLOOR that it be a
 *          writable issue field.                     ← JSON recipe (derived data)
 *          └─ text / select / date / … (concrete) — each adds only its type specifics (a choice needs options).
 *                                                    ← JSON recipes (derived data)
 *
 * Only the concrete leaves are ever instantiated (a form field's `type` is `text`/`select`/…); the two abstract
 * ancestors can never be used raw (`validateFieldInstance` rejects them). The derived recipes carry the leaf set;
 * a drift test pins it to `FORM_FIELD_TYPES` (the one type union the SPA field family also uses) + the `mapTo`
 * allow-list to `ISSUE_WRITE_TARGETS`, so the JSON can't silently drift from the accepted set.
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

/** ROOT — the most permissive shape: identity + label + type + the common optional config. No floors. Code. */
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

/** The DERIVED field recipes (form-field + one per concrete type), authored as JSON. */
const DERIVED_FIELD_PRIMITIVES = [
  formField, textField, textareaField, numberField, dateField, emailField, urlField,
  selectField, radioField, likertField, multiselectField, checkboxField, yesnoField, addressField,
] as unknown as FieldPrimitive[];

const FIELD_PRIMITIVES: FieldPrimitive[] = [FIELD_ROOT, ...DERIVED_FIELD_PRIMITIVES];
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
  // SECURITY FLOOR: a field that captures input (not a display-only `label`) must resolve to a sanitise policy
  // + validation. The policy engine guarantees this for every input type, so this proves the invariant holds
  // (and would catch a future field type shipped without one).
  const overrides: { validation?: FieldValidation; sanitise?: SanitisePolicy; options?: unknown } = { options: field["options"] };
  if (field["validation"] !== undefined) overrides.validation = field["validation"] as FieldValidation;
  if (field["sanitise"] !== undefined) overrides.sanitise = field["sanitise"] as SanitisePolicy;
  const policyError = assertFieldHasPolicy(type, overrides, label);
  if (policyError) errors.push(policyError);
  return errors;
}

/** Validate a form's `fields[]` as field-primitive instances (the per-element half of form validation). Empty
 *  when `fields` isn't an array — the container `min-fields` floor already reports a missing/empty field set. */
export function validateFormFields(fields: unknown): string[] {
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((f) => (f && typeof f === "object" && !Array.isArray(f)) ? validateFieldInstance(f as Record<string, unknown>) : ["a field must be an object"]);
}
