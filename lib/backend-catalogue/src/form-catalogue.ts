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

/** The supported field input types. */
export type FormFieldType = "text" | "textarea" | "number" | "date" | "select" | "checkbox";

/** One field on a form. `options` is required for `select`. */
export interface FormFieldDef {
  key: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  help?: string;
}

/**
 * Where a submission lands. Phase 1 targets an issue in a project. `projectId` is optional on a shipped
 * template (a template is untargeted until an admin binds it); it is required to actually submit. `titleFrom`
 * names the field used as the issue title, `map` routes extra fields onto writable issue fields, and
 * `status`/`priority`/`labels` stamp an intake marker.
 */
export interface FormTargetDef {
  kind: "issue";
  projectId?: string;
  titleFrom?: string;
  status?: string;
  priority?: string;
  labels?: string[];
  map?: Record<string, string>;
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
}

/** The shipped form TEMPLATES, in display order. Untargeted — an admin binds `target.projectId`. */
export const FORMS: FormDefinition[] = [
  {
    id: "intake-request",
    label: "Work request",
    description: "Submit a new piece of work for triage.",
    submitLabel: "Submit request",
    methodologies: ["*"],
    fields: [
      { key: "summary", label: "Summary", type: "text", required: true, placeholder: "Short title for the request" },
      { key: "details", label: "What do you need?", type: "textarea", required: true },
      { key: "priority", label: "Priority", type: "select", options: ["Low", "Medium", "High", "Critical"], required: true },
      { key: "neededBy", label: "Needed by", type: "date" },
      { key: "requestedBy", label: "Requested by", type: "text" },
    ],
    target: { kind: "issue", titleFrom: "summary", status: "triage", labels: ["intake"], map: { priority: "priority", dueDate: "neededBy" } },
  },
  {
    id: "change-request",
    label: "Change request",
    description: "Request a change to an in-flight project (governance intake).",
    submitLabel: "Raise change",
    methodologies: ["prince2", "waterfall", "governance"],
    fields: [
      { key: "summary", label: "Change summary", type: "text", required: true },
      { key: "rationale", label: "Rationale / business case", type: "textarea", required: true },
      { key: "impact", label: "Impact", type: "select", options: ["Low", "Medium", "High"], required: true },
      { key: "urgency", label: "Urgency", type: "select", options: ["Low", "Medium", "High"], required: true },
    ],
    target: { kind: "issue", titleFrom: "summary", status: "triage", labels: ["change-request"], map: { impact: "impact", urgency: "urgency" } },
  },
];

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
