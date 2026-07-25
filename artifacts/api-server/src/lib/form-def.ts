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
import { ISSUE_WRITE_TARGETS, LIKERT_DEFAULT_OPTIONS, ADDRESS_SUBFIELDS, FORM_CONTAINER_CONSTRAINTS, evaluateConstraints, kindElementErrors, type FormDefinition, type FormFieldDef, type FormFieldType, type FormTargetDef } from "@workspace/backend-catalogue";
import { isEmailShape } from "./email-shape";

export class FormDefError extends Error {
  constructor(message: string) { super(message); this.name = "FormDefError"; }
}

/** Hard ceiling on any text-ish field even when a def sets a larger (or no) maxLength — defence in depth
 *  beneath the global 256kb body limit, so a single field can't carry an unbounded blob into an issue.
 *  Enforced at SUBMISSION (`capLength`), the point the value actually lands. */
const ABSOLUTE_MAX_LEN = 10_000;
const DEFAULT_MAX_LEN = 2_000;

// The canonical form shapes live in the shared catalogue (single source of truth for both apps). Alias them
// to the server's historical names so the rest of the server keeps its imports.
export type FormField = FormFieldDef;
export type FormTarget = FormTargetDef;
export type FormDef = FormDefinition;
export type { FormFieldType };

/** Issue fields a form is allowed to map onto (a safe subset of IssueWrite — strings/number/labels only). */
export const ISSUE_WRITE_ALLOWLIST = new Set<string>(ISSUE_WRITE_TARGETS);

/** Targets that AGGREGATE several fields; every other target is scalar (one field each). `description`
 *  concatenates "Label: value" lines; `labels` collects each value into the labels array. */
export const AGGREGATING_TARGETS = new Set<string>(["description", "labels"]);

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");



/**
 * Validate a form DEFINITION's container invariants (≥1 field, exactly one title, distinct scalar targets) by
 * running the shared engine floors against it — the SAME rules the importer enforces on a form's composed whole.
 * Called at the point of USE (submission) so the submission path validates the RESOLVED def through the one
 * engine rather than trusting an authoring-time validator: single source of truth, and it catches a def that a
 * scope override may have drifted. Returns one message per broken invariant ([] = sound). Value validation
 * (types / options / required) stays in `validateSubmission`.
 */
export function formContainerErrors(def: FormDef): string[] {
  const rec = def as unknown as Record<string, unknown>;
  return [
    ...evaluateConstraints(rec, FORM_CONTAINER_CONSTRAINTS),
    ...kindElementErrors("form", rec),
  ];
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
      case "yesno": {
        // A boolean rendered as Yes/No — accept the common encodings.
        clean[field.key] = v === true || v === "true" || v === "yes" || v === "Yes";
        break;
      }
      case "select":
      case "radio":
      case "likert": {
        const s = str(v);
        // A likert defaults its scale when the author supplied none (kept here now that the monolithic form
        // validator, which used to bake the default into the stored def, is gone).
        const options = (field.options && field.options.length) ? field.options : (field.type === "likert" ? [...LIKERT_DEFAULT_OPTIONS] : field.options);
        if (!options?.includes(s)) throw new FormDefError(`"${field.label}" must be one of: ${(options ?? []).join(", ")}`);
        clean[field.key] = s;
        break;
      }
      case "multiselect": {
        const arr = Array.isArray(v) ? v.map(str) : str(v) ? [str(v)] : [];
        if (field.required && arr.length === 0) throw new FormDefError(`"${field.label}" needs at least one selection`);
        for (const item of arr) if (!field.options?.includes(item)) throw new FormDefError(`"${field.label}" has an invalid option "${item}"`);
        clean[field.key] = arr;
        break;
      }
      case "address": {
        // A composite of sub-fields — keep only the known ones, trimmed + length-capped.
        const o = (v && typeof v === "object" && !Array.isArray(v)) ? (v as Record<string, unknown>) : {};
        const addr: Record<string, string> = {};
        for (const sub of ADDRESS_SUBFIELDS) { const val = str(o[sub]); if (val) { capLength(field, val); addr[sub] = val; } }
        if (field.required && !addr["line1"] && !addr["city"]) throw new FormDefError(`"${field.label}" needs at least a street or city`);
        clean[field.key] = addr;
        break;
      }
      case "email": {
        const s = str(v);
        capLength(field, s);
        if (!isEmailShape(s)) throw new FormDefError(`"${field.label}" must be a valid email address`);
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

/** Enforce a text field's length: its own maxLength (hard-clamped to ABSOLUTE_MAX_LEN) or the default. The clamp
 *  lives here now — the point the value actually lands — rather than at authoring time. */
function capLength(field: FormFieldDef, s: string): void {
  const limit = Math.min(field.maxLength ?? DEFAULT_MAX_LEN, ABSOLUTE_MAX_LEN);
  if (s.length > limit) throw new FormDefError(`"${field.label}" must be at most ${limit} characters`);
}

/**
 * Build the IssueWrite payload for a validated submission: title from `titleFrom` (or the form label),
 * a readable description folding in every answered field, the intake marker (status/priority/labels), and
 * any allow-listed mapped fields. Returned as a plain record the route spreads into `broker.writeIssue`.
 */
export function issueWriteFromSubmission(def: FormDef, clean: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (def.target.projectId) out["projectId"] = def.target.projectId;
  // Intake markers first (a field mapping to the same target overrides / aggregates onto them).
  if (def.target.status) out["status"] = def.target.status;
  const labels: string[] = [...(def.target.labels ?? [])];
  const descLines: string[] = def.description ? [def.description] : [];

  // Route EACH answered field to its mapped backend field. description/labels aggregate; others are scalar.
  // Rich values (multiselect arrays, address objects) are serialised to a string for scalar/description
  // targets, or fanned into the labels array element-by-element for a labels target.
  for (const f of def.fields) {
    const v = clean[f.key];
    if (v === undefined) continue;
    if (f.mapTo === "labels") { for (const s of asStrings(v)) if (s) labels.push(s); }
    else if (f.mapTo === "description") descLines.push(`${f.label}: ${serializeValue(v)}`);
    else out[f.mapTo] = Array.isArray(v) || (v && typeof v === "object") ? serializeValue(v) : v;
  }

  if (descLines.length > 0) out["description"] = descLines.join("\n");
  if (labels.length > 0) out["labels"] = labels;
  return out;
}

/** A value as a flat list of strings (for the labels target): array → its elements; address → its lines. */
function asStrings(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(str).filter(Boolean);
  if (v && typeof v === "object") return Object.values(v as Record<string, unknown>).map(str).filter(Boolean);
  return str(v) ? [str(v)] : [];
}

/** Serialise a submitted value to a single human-readable string (for a scalar / description target). */
function serializeValue(v: unknown): string {
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join(", ");
  if (v && typeof v === "object") return ADDRESS_SUBFIELDS.map((k) => str((v as Record<string, unknown>)[k])).filter(Boolean).join(", ");
  return String(v);
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

/** The distinct issue fields a form's fields map to that AREN'T vendor-advertised writable — for authoring
 *  rejection ("you can't map to X; the backend doesn't support writing it"). */
export function unwritableMapFields(def: FormDef, writable: ReadonlySet<string>): string[] {
  const bad = new Set<string>();
  for (const f of def.fields) if (!CORE_ISSUE_FIELDS.has(f.mapTo) && !writable.has(f.mapTo)) bad.add(f.mapTo);
  return [...bad];
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
