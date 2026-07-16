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

const FIELD_TYPES = new Set<string>(["text", "textarea", "number", "date", "select", "checkbox", "email", "url"]);
/** Hard ceiling on any text-ish field even when a def sets a larger (or no) maxLength — defence in depth
 *  beneath the global 256kb body limit, so a single field can't carry an unbounded blob into an issue. */
const ABSOLUTE_MAX_LEN = 10_000;
const DEFAULT_MAX_LEN = 2_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      if (!FIELD_TYPES.has(type)) throw new FormDefError(`form "${id}" field "${key}" type must be one of text, textarea, number, date, select, checkbox, email, url`);
      const field: FormField = { key, label: fLabel, type: type as FormFieldType };
      if (f["required"] === true) field.required = true;
      if (type === "select") {
        const options = Array.isArray(f["options"]) ? (f["options"] as unknown[]).map(str).filter(Boolean) : [];
        if (options.length === 0) throw new FormDefError(`form "${id}" select field "${key}" needs options`);
        field.options = options;
      }
      if (f["maxLength"] != null) {
        const ml = Number(f["maxLength"]);
        if (!Number.isInteger(ml) || ml <= 0) throw new FormDefError(`form "${id}" field "${key}" maxLength must be a positive integer`);
        field.maxLength = Math.min(ml, ABSOLUTE_MAX_LEN);
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
      case "email": {
        const s = str(v);
        capLength(field, s);
        if (!EMAIL_RE.test(s)) throw new FormDefError(`"${field.label}" must be a valid email address`);
        clean[field.key] = s;
        break;
      }
      case "url": {
        const s = str(v);
        capLength(field, s);
        // Only http(s) — never javascript:/data:/file: (blocked before this value can reach a link or egress).
        let ok = false;
        try { const u = new URL(s); ok = u.protocol === "http:" || u.protocol === "https:"; } catch { ok = false; }
        if (!ok) throw new FormDefError(`"${field.label}" must be a valid http(s) URL`);
        clean[field.key] = s;
        break;
      }
      default: {
        // text / textarea / date — kept as a trimmed string, length-capped.
        const s = str(v);
        capLength(field, s);
        clean[field.key] = s;
      }
    }
  }
  return clean;
}

/** Enforce a text field's length: its own maxLength (already clamped to ABSOLUTE_MAX_LEN) or the default. */
function capLength(field: FormFieldDef, s: string): void {
  const limit = field.maxLength ?? DEFAULT_MAX_LEN;
  if (s.length > limit) throw new FormDefError(`"${field.label}" must be at most ${limit} characters`);
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

/**
 * CORE issue fields a create always carries — never capability-gated (a create is meaningless without a
 * project + title, and the backend rejects if it truly can't store them).
 */
export const CORE_ISSUE_FIELDS = new Set<string>(["projectId", "title"]);

/**
 * A form may only write issue fields the connected backend ADVERTISES as storable (`FieldSupport.store`).
 * `writable` is that advertised, storable-field set (resolved per-request from the backend capabilities).
 * These pure helpers keep form-def.ts free of any request/broker import so they stay unit-testable.
 */

/** The target.map issue-field keys a form maps to that AREN'T vendor-advertised writable — for authoring
 *  rejection ("you can't map to X; the backend doesn't support writing it"). */
export function unwritableMapFields(def: FormDef, writable: ReadonlySet<string>): string[] {
  return Object.keys(def.target.map ?? {}).filter((k) => !CORE_ISSUE_FIELDS.has(k) && !writable.has(k));
}

/** Defensive submit-time filter: drop any composed issue field the backend doesn't advertise as storable
 *  (the connected backend may have changed since the form was authored). Core fields are always kept. */
export function filterIssueWriteToWritable(
  issueWrite: Record<string, unknown>,
  writable: ReadonlySet<string>,
): { issue: Record<string, unknown>; dropped: string[] } {
  const issue: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(issueWrite)) {
    if (CORE_ISSUE_FIELDS.has(k) || writable.has(k)) issue[k] = v;
    else dropped.push(k);
  }
  return { issue, dropped };
}
