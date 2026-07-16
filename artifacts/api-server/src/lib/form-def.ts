/**
 * Intake / request FORMS — the definition + submission logic. An admin/PMO authors a form (a set of typed
 * fields + a target project) and stores it in the per-deployment config store; end users fill it in and each
 * submission becomes a work item created through the broker (same write path as the issue grid). This module
 * owns the shape validator, per-submission validation/coercion, and the mapping from a submission to an
 * IssueWrite. No storage or I/O here — pure, so it validates cleanly and can't be a crash sink (typed 400s).
 *
 * Same "JSON def in the encrypted config store, rendered by a generic primitive" pattern as screen defs and
 * the RACI / stakeholder registers.
 */
import type { FormDefinition, FormFieldDef, FormFieldType, FormTargetDef } from "@workspace/backend-catalogue";

export class FormDefError extends Error {
  constructor(message: string) { super(message); this.name = "FormDefError"; }
}

const FIELD_TYPES = new Set<string>(["text", "textarea", "number", "date", "select", "checkbox"]);

// The canonical form shapes live in the shared catalogue (single source of truth for both apps). Alias them
// to the server's historical names so the rest of the server keeps its imports.
export type FormField = FormFieldDef;
export type FormTarget = FormTargetDef;
export type FormDef = FormDefinition;
export type { FormFieldType };

/** Issue fields a form is allowed to map onto (a safe subset of IssueWrite — strings/number/labels only). */
export const ISSUE_WRITE_ALLOWLIST = new Set<string>([
  "title", "description", "priority", "assignee", "labels", "dueDate", "startDate",
  "storyPoints", "estimateHours", "budget", "impact", "urgency", "riskLevel", "healthStatus",
]);

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const isForbiddenKey = (k: string): boolean => k === "__proto__" || k === "constructor" || k === "prototype";

/** Validate + normalise the stored forms list. Pure — throws {@link FormDefError}. */
export function validateForms(value: unknown): FormDef[] {
  if (!Array.isArray(value)) throw new FormDefError("forms must be an array");
  const ids = new Set<string>();
  return value.map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const id = str(o["id"]);
    const label = str(o["label"]);
    if (!id || !label) throw new FormDefError("each form needs an id and a label");
    if (ids.has(id)) throw new FormDefError(`duplicate form id "${id}"`);
    ids.add(id);

    if (!Array.isArray(o["fields"]) || o["fields"].length === 0) throw new FormDefError(`form "${id}" needs at least one field`);
    const fieldKeys = new Set<string>();
    const fields = (o["fields"] as unknown[]).map((rawF) => {
      const f = (rawF ?? {}) as Record<string, unknown>;
      const key = str(f["key"]);
      const fLabel = str(f["label"]);
      const type = str(f["type"]);
      if (!key || isForbiddenKey(key)) throw new FormDefError(`form "${id}" has a field with a missing/invalid key`);
      if (fieldKeys.has(key)) throw new FormDefError(`form "${id}" has a duplicate field key "${key}"`);
      fieldKeys.add(key);
      if (!fLabel) throw new FormDefError(`form "${id}" field "${key}" needs a label`);
      if (!FIELD_TYPES.has(type)) throw new FormDefError(`form "${id}" field "${key}" type must be one of text, textarea, number, date, select, checkbox`);
      const field: FormField = { key, label: fLabel, type: type as FormFieldType };
      if (f["required"] === true) field.required = true;
      if (type === "select") {
        const options = Array.isArray(f["options"]) ? (f["options"] as unknown[]).map(str).filter(Boolean) : [];
        if (options.length === 0) throw new FormDefError(`form "${id}" select field "${key}" needs options`);
        field.options = options;
      }
      if (str(f["placeholder"])) field.placeholder = str(f["placeholder"]);
      if (str(f["help"])) field.help = str(f["help"]);
      return field;
    });

    const rawTarget = (o["target"] ?? {}) as Record<string, unknown>;
    if (str(rawTarget["kind"]) !== "issue") throw new FormDefError(`form "${id}" target.kind must be "issue"`);
    // projectId is OPTIONAL on a def: a shipped/template form is untargeted until an admin binds it. The
    // submit endpoint refuses an untargeted form (400) — validation here allows it so templates can be stored.
    const projectId = str(rawTarget["projectId"]);
    const target: FormTarget = { kind: "issue", ...(projectId ? { projectId } : {}) };
    const titleFrom = str(rawTarget["titleFrom"]);
    if (titleFrom) {
      if (!fieldKeys.has(titleFrom)) throw new FormDefError(`form "${id}" target.titleFrom "${titleFrom}" is not a field`);
      target.titleFrom = titleFrom;
    }
    if (str(rawTarget["status"])) target.status = str(rawTarget["status"]);
    if (str(rawTarget["priority"])) target.priority = str(rawTarget["priority"]);
    if (Array.isArray(rawTarget["labels"])) target.labels = (rawTarget["labels"] as unknown[]).map(str).filter(Boolean);
    if (rawTarget["map"] && typeof rawTarget["map"] === "object" && !Array.isArray(rawTarget["map"])) {
      const map: Record<string, string> = {};
      for (const [issueField, formKey] of Object.entries(rawTarget["map"] as Record<string, unknown>)) {
        if (isForbiddenKey(issueField)) continue;
        if (!ISSUE_WRITE_ALLOWLIST.has(issueField)) throw new FormDefError(`form "${id}" target.map key "${issueField}" is not a writable issue field`);
        const fk = str(formKey);
        if (!fieldKeys.has(fk)) throw new FormDefError(`form "${id}" target.map "${issueField}" points at unknown field "${fk}"`);
        map[issueField] = fk;
      }
      if (Object.keys(map).length > 0) target.map = map;
    }

    const def: FormDef = { id, label, fields, target };
    if (str(o["description"])) def.description = str(o["description"]);
    if (str(o["submitLabel"])) def.submitLabel = str(o["submitLabel"]);
    if (o["enabled"] === false) def.enabled = false;
    if (Array.isArray(o["methodologies"])) def.methodologies = (o["methodologies"] as unknown[]).map(str).filter(Boolean);
    return def;
  });
}

/**
 * Validate a raw submission against a form def and return cleaned, type-coerced values. Throws
 * {@link FormDefError} (→ 400) on a missing required field or a value that doesn't fit its field type.
 */
export function validateSubmission(def: FormDef, values: unknown): Record<string, unknown> {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new FormDefError("submission values must be an object");
  const raw = values as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  for (const field of def.fields) {
    const v = raw[field.key];
    const present = v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "");
    if (!present) {
      if (field.required) throw new FormDefError(`"${field.label}" is required`);
      continue;
    }
    switch (field.type) {
      case "number": {
        const n = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(n)) throw new FormDefError(`"${field.label}" must be a number`);
        clean[field.key] = n;
        break;
      }
      case "checkbox": {
        clean[field.key] = v === true || v === "true" || v === "on";
        break;
      }
      case "select": {
        const s = str(v);
        if (!field.options?.includes(s)) throw new FormDefError(`"${field.label}" must be one of: ${(field.options ?? []).join(", ")}`);
        clean[field.key] = s;
        break;
      }
      default: {
        // text / textarea / date — kept as a trimmed string.
        clean[field.key] = str(v);
      }
    }
  }
  return clean;
}

/**
 * Build the IssueWrite payload for a validated submission: title from `titleFrom` (or the form label),
 * a readable description folding in every answered field, the intake marker (status/priority/labels), and
 * any allow-listed mapped fields. Returned as a plain record the route spreads into `broker.writeIssue`.
 */
export function issueWriteFromSubmission(def: FormDef, clean: Record<string, unknown>): Record<string, unknown> {
  const labelFor = (key: string): string => def.fields.find((f) => f.key === key)?.label ?? key;
  const title = (def.target.titleFrom ? str(clean[def.target.titleFrom]) : "") || def.label;

  // Compose a description from every answered field, so nothing the user typed is lost.
  const lines = def.fields
    .filter((f) => clean[f.key] !== undefined)
    .map((f) => `${f.label}: ${String(clean[f.key])}`);
  const description = [def.description, lines.join("\n")].filter(Boolean).join("\n\n") || undefined;

  const out: Record<string, unknown> = { projectId: def.target.projectId, title };
  if (description) out["description"] = description;
  if (def.target.status) out["status"] = def.target.status;
  if (def.target.priority) out["priority"] = def.target.priority;
  if (def.target.labels && def.target.labels.length > 0) out["labels"] = [...def.target.labels];

  // Allow-listed field mapping overrides the composed defaults where configured.
  for (const [issueField, formKey] of Object.entries(def.target.map ?? {})) {
    const v = clean[formKey];
    if (v === undefined) continue;
    if (issueField === "labels") out["labels"] = [...(out["labels"] as string[] | undefined ?? []), str(v)].filter(Boolean);
    else out[issueField] = v;
  }
  void labelFor; // (kept for future per-field descriptions)
  return out;
}
