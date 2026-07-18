import type { DefConstraint } from "./def-constraints";
import { FORM_AGGREGATING_TARGETS } from "./form-catalogue";
import { validateFormFields } from "./field-primitive-catalogue";

/**
 * KIND-ROOT CONSTRAINTS — the container-primitive floors that bind a WHOLE kind, expressed as declarative data
 * rather than hardcoded in a per-kind validator. They are the implicit ROOT of every def of that kind: prepended
 * to a def's lineage during composed-whole validation, so they apply to a standalone def AND to every fork, and
 * because they are FLOORS a fork can only tighten them, never relax them (to escape one you'd have to branch
 * above the kind root — i.e. author a different kind). This is where a rule like "every FORM has exactly one
 * field bound to title" lives now: as data on the form container, checked by the generic constraint engine.
 *
 * (The per-FIELD checks a form still needs — a field's type is known, its `mapTo` is a writable target, a choice
 * field has options — remain in `form-def.validateForms` for now; those belong on the field PRIMITIVES and move
 * there in a later slice. This module owns only the container-set rules.)
 */
export const FORM_CONTAINER_CONSTRAINTS: DefConstraint[] = [
  { id: "form-min-fields", kind: "floor", type: "cardinality", path: "fields", min: 1, message: "a form needs at least one field" },
  { id: "form-one-title", kind: "floor", type: "cardinality", path: "fields", where: { field: "mapTo", eq: "title" }, min: 1, max: 1, message: 'a form must have exactly one field mapping to "title"' },
  { id: "form-unique-targets", kind: "floor", type: "unique", path: "fields", field: "mapTo", except: [...FORM_AGGREGATING_TARGETS], message: "each field must map to a distinct target (only description/labels may be shared)" },
  { id: "form-unique-keys", kind: "floor", type: "unique", path: "fields", field: "key", message: "field keys must be unique" },
];

/**
 * The implicit root constraints every def of `kind` inherits (empty for kinds with no container floors). The
 * importer prepends these to a def's lineage when validating its composed whole, so the floor binds the whole
 * kind and no fork can relax it.
 */
export function kindRootConstraints(kind: string): DefConstraint[] {
  return kind === "form" ? FORM_CONTAINER_CONSTRAINTS : [];
}

/**
 * The PER-ELEMENT validation for a kind whose children are primitive instances — beyond the container floors,
 * each child is validated against its own primitive. For a `form` that's each `fields[]` entry against its field
 * primitive (type known, required params present, the inherited `mapTo` allow-list floor, choice options). Run on
 * the COMPOSED whole at import and on the RESOLVED def at submission — the single engine-owned per-field check
 * that lets the monolithic form validator retire without losing the allow-list. Empty for kinds with no
 * primitive-instance children.
 */
export function kindElementErrors(kind: string, def: Record<string, unknown>): string[] {
  return kind === "form" ? validateFormFields(def["fields"]) : [];
}
