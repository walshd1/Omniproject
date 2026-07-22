/**
 * FORM registry — intake / request forms OmniProject can render. Same architectural principle as reports,
 * screens and views: a form is a neutral JSON DEFINITION (typed fields + a target), authored once and
 * rendered by a generic primitive, methodology-tagged so a methodology bundle can ship its own forms.
 *
 * These are the shipped TEMPLATES. Because a form WRITES into a specific project, a template ships without a
 * bound `projectId`; an admin/PMO instantiates a template into their org's `forms` config and points it at a
 * project (or builds one from scratch). The org store is the authoritative, submittable set — the same
 * "built-in catalogue + org override" split screens use.
 */
import { matchesMethodology } from "./methodology-match";
import { FORMS_DATA } from "./forms.generated";

/**
 * The supported field input types — each is effectively a small CLASS: its config are properties (options,
 * required, maxLength), it produces a typed value, and it carries validate/serialize behaviour (in
 * form-def.ts). `email`/`url` validate a format; `select`/`radio`/`likert` are single-choice; `multiselect`
 * is multi-choice (array value); `yesno` is a boolean; `address` is a composite of sub-fields.
 */
export type FormFieldType =
  | "text" | "textarea" | "number" | "date" | "email" | "url"
  | "select" | "radio" | "likert" | "multiselect" | "checkbox" | "yesno" | "address";

/** The field-input primitives, as a value (the single list the validator, admin picker and the unified
 *  primitive store all draw from — so the `field` family can't drift from the FormFieldType union). */
export const FORM_FIELD_TYPES: readonly FormFieldType[] = [
  "text", "textarea", "number", "date", "email", "url",
  "select", "radio", "likert", "multiselect", "checkbox", "yesno", "address",
];

/** The default agreement scale a `likert` field uses when the author doesn't supply its own options. */
export const LIKERT_DEFAULT_OPTIONS: readonly string[] = [
  "Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree",
];

/** The sub-fields a composite `address` primitive collects, in order. */
export const ADDRESS_SUBFIELDS: readonly string[] = ["line1", "line2", "city", "region", "postcode", "country"];

/**
 * One field on a form. `options` is required for `select`. Every field MUST declare `mapTo` — the backend
 * (issue) field its value is written to — so nothing a user types is homeless: if a value has no backend
 * field to live in, the field can't exist. `mapTo` must be a writable issue field the connected backend
 * advertises (enforced server-side); `description` and `labels` are the aggregating targets (many fields may
 * map to them), every other target is scalar (one field each).
 */
export interface FormFieldDef {
  key: string;
  label: string;
  type: FormFieldType;
  /** REQUIRED — the backend/issue field this field's value is written to. */
  mapTo: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  help?: string;
  /** Max characters for a text-ish field (text/textarea/email/url). Bounded and defaulted server-side. */
  maxLength?: number;
}

/**
 * Where a submission lands: an issue in a project. `projectId` is optional on a shipped template (untargeted
 * until an admin binds it); required to submit. `status`/`labels` stamp an intake marker on the created
 * issue. The field→backend mapping now lives on each field (`FormFieldDef.mapTo`), not here.
 */
export interface FormTargetDef {
  kind: "issue";
  projectId?: string;
  status?: string;
  labels?: string[];
}

/** A form definition. */
export interface FormDefinition {
  id: string;
  label: string;
  description?: string;
  fields: FormFieldDef[];
  target: FormTargetDef;
  submitLabel?: string;
  /** Off forms exist in config but refuse submissions and hide from nav. Defaults to on. */
  enabled?: boolean;
  /** Methodology tags — "*"/omitted = neutral (all). */
  methodologies?: string[];
  /** COMPOSITION: the id of a parent form this one is built on (see def-compose). A customer fork records its
   *  parent here so the importer traces its ancestry + guards the chain. Omitted = a root/template form. */
  extends?: string;
}

/** The shipped form TEMPLATES — authored as JSON under assets/forms/ and generated into `forms.generated.ts`
 *  (mirrors reports/screens/views, per this module's own "form is a neutral JSON definition" principle). Add a
 *  form by dropping a JSON file, not by editing code. Untargeted — an admin binds `target.projectId`. */
export const FORMS: FormDefinition[] = FORMS_DATA;

/** The issue fields a form field may map onto (`FormFieldDef.mapTo`). The single source both the server
 *  validator and the admin builder's "maps to" picker draw from. `description`/`labels` aggregate several
 *  fields; the rest are scalar (one field each). Availability is further gated by backend capabilities. */
export const ISSUE_WRITE_TARGETS = [
  "title", "description", "priority", "assignee", "labels", "dueDate", "startDate",
  "storyPoints", "estimateHours", "budget", "impact", "urgency", "riskLevel", "healthStatus",
] as const;

/** The targets that AGGREGATE several fields (many-to-one) — every other target is scalar (one field each).
 *  Single source of truth for the form uniqueness rule (the `except` set of its unique constraint). */
export const FORM_AGGREGATING_TARGETS = ["description", "labels"] as const;

const byId = new Map(FORMS.map((f) => [f.id, f]));

/** One form template by id, or undefined. */
export function getForm(id: string): FormDefinition | undefined {
  return byId.get(id);
}

/** All form templates (a defensive copy). */
export function formCatalogue(): FormDefinition[] {
  return FORMS.map((f) => ({ ...f }));
}

/** The form templates tagged for a methodology (neutral tags always match). */
export function formsForMethodology(methodology: string): FormDefinition[] {
  return FORMS.filter((f) => matchesMethodology(f.methodologies, methodology));
}
