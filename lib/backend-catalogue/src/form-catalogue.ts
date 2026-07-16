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

/** The supported field input types. `email`/`url` are text fields with format validation. */
export type FormFieldType = "text" | "textarea" | "number" | "date" | "select" | "checkbox" | "email" | "url";

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
      { key: "summary", label: "Summary", type: "text", mapTo: "title", required: true, placeholder: "Short title for the request", maxLength: 200 },
      { key: "details", label: "What do you need?", type: "textarea", mapTo: "description", required: true, maxLength: 4000 },
      { key: "priority", label: "Priority", type: "select", mapTo: "priority", options: ["low", "medium", "high", "urgent"], required: true },
      { key: "neededBy", label: "Needed by", type: "date", mapTo: "dueDate" },
      { key: "requestedBy", label: "Requested by", type: "text", mapTo: "description", maxLength: 120 },
    ],
    target: { kind: "issue", status: "triage", labels: ["intake"] },
  },
  {
    id: "change-request",
    label: "Change request",
    description: "Request a change to an in-flight project (governance intake).",
    submitLabel: "Raise change",
    methodologies: ["prince2", "waterfall", "governance"],
    fields: [
      { key: "summary", label: "Change summary", type: "text", mapTo: "title", required: true, maxLength: 200 },
      { key: "rationale", label: "Rationale / business case", type: "textarea", mapTo: "description", required: true, maxLength: 4000 },
      { key: "impact", label: "Impact", type: "select", mapTo: "impact", options: ["low", "medium", "high"], required: true },
      { key: "urgency", label: "Urgency", type: "select", mapTo: "urgency", options: ["low", "medium", "high"], required: true },
    ],
    target: { kind: "issue", status: "triage", labels: ["change-request"] },
  },
];

/** The issue fields a form field may map onto (`FormFieldDef.mapTo`). The single source both the server
 *  validator and the admin builder's "maps to" picker draw from. `description`/`labels` aggregate several
 *  fields; the rest are scalar (one field each). Availability is further gated by backend capabilities. */
export const ISSUE_WRITE_TARGETS = [
  "title", "description", "priority", "assignee", "labels", "dueDate", "startDate",
  "storyPoints", "estimateHours", "budget", "impact", "urgency", "riskLevel", "healthStatus",
] as const;

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
