import { FIELD_REGISTRY, CANONICAL_FIELD_KEYS, type FieldDescriptor } from "@workspace/backend-catalogue";
import type { EnumeratedField } from "./field-registry";
import { BUILTIN_BROKER, SIDECAR_BACKEND, type FieldRef } from "./field-target";
import { deriveValidationRule, type FieldValidationRule } from "./field-validation";

/**
 * THE LIVE SUPERSET (roadmap §4.6) — the set of fields an admin may map a UI element onto, built DYNAMICALLY
 * from every connected backend (plus our sidecar when it's on). It answers "what can I map, and what does each
 * field hold?":
 *
 *  - a) it's the union of every field advertised by every connected backend — the canonical superset made live;
 *  - b) DUPLICATES ARE KEPT DISTINCT: Jira's task `summary` and Todoist's task `content` both reconcile to the
 *       canonical `title`, but they stay TWO entries (title ← jira, title ← todoist), each with its own origin
 *       and constraints, so the admin sees exactly which backend a field comes from;
 *  - c) it EXPANDS and SHRINKS as backends connect/disconnect — it's rebuilt from the current connected set;
 *  - d) turning the SIDECAR on adds a source for EVERY canonical field (our sidecar can hold any type), so the
 *       full canonical vocabulary becomes mappable via the built-in home.
 *
 * Each entry carries the three things a mapping needs: WHERE it originated (`system` + `nativeField`), WHAT it
 * holds (`type` + `maxLength`/`precision`/`options`/`nullable`), and its canonical identity (`canonicalKey`).
 * PURE: given the per-backend enumerations, it computes the superset — no I/O.
 */

/** One mappable field in the live superset — a single backend's field, reconciled to a canonical concept but
 *  kept DISTINCT per backend (no cross-backend merge). */
export interface SupersetField {
  /** Stable id, `<system>:<nativeField>` — distinct per backend even when two share a canonical concept. */
  id: string;
  /** The canonical concept this reconciles to (a registry key), or the raw key when the backend field isn't
   *  in the canonical registry (a custom/unknown field carried as passthrough). */
  canonicalKey: string;
  /** Human label (canonical registry label when known, else the backend's advertised label). */
  label: string;
  /** The broker hop that fronts this field's backend (e.g. "n8n", "builtin"). */
  broker: string;
  /** The connected backend this field originates from (its origin/lineage). */
  system: string;
  /** The backend's native field id (what the broker actually reads/writes). */
  nativeField: string;
  /** Data type. */
  type: string;
  /** Advertised constraints (absent ⇒ unconstrained on that facet — e.g. the sidecar has no maxLength). */
  maxLength?: number;
  precision?: number;
  options?: string[];
  /** A regex the value must match (postcode/email/date). */
  pattern?: string;
  nullable?: boolean;
  /** Whether the canonical concept is in the registry (`true`) or a backend custom/unknown field (`false`). */
  canonical: boolean;
  group?: string;
}

/** One connected backend's advertised fields, tagged with the broker hop that fronts it. */
export interface SupersetInput { broker: string; system: string; fields: EnumeratedField[] }

const REGISTRY_BY_KEY = new Map<string, FieldDescriptor>(FIELD_REGISTRY.map((f) => [f.key, f]));

/** Project one backend's enumerated field into a superset entry (canonical label/group when the key is known).
 *  The field's own `sourceSystem` wins over the input default, so one broker fronting several backends stays
 *  distinct per backend. */
function toSupersetField(broker: string, defaultSystem: string, f: EnumeratedField): SupersetField | null {
  const native = f.sourceField || f.key;
  if (!f.key || !native) return null;
  const system = f.sourceSystem || defaultSystem;
  const canonicalKey = f.key;
  const canonical = CANONICAL_FIELD_KEYS.has(canonicalKey);
  const desc = REGISTRY_BY_KEY.get(canonicalKey);
  const out: SupersetField = {
    id: `${system}:${native}`,
    canonicalKey,
    label: f.label || desc?.label || canonicalKey,
    broker,
    system,
    nativeField: native,
    type: f.type || desc?.type || "string",
    canonical,
  };
  if (desc?.group) out.group = desc.group;
  if (f.maxLength !== undefined) out.maxLength = f.maxLength;
  if (f.precision !== undefined) out.precision = f.precision;
  if (f.options !== undefined) out.options = f.options;
  if (f.pattern !== undefined) out.pattern = f.pattern;
  if (f.nullable !== undefined) out.nullable = f.nullable;
  return out;
}

/**
 * Build the live superset from the connected backends' enumerations. DISTINCT per backend; de-duplicated only on
 * exact `<system>:<nativeField>` (a backend listing a field twice), first wins. The result grows/shrinks purely
 * with `inputs`, so connecting or disconnecting a backend changes what's mappable.
 */
export function buildLiveSuperset(inputs: SupersetInput[]): SupersetField[] {
  const out: SupersetField[] = [];
  const seen = new Set<string>();
  for (const inp of inputs) {
    for (const f of inp.fields) {
      const sf = toSupersetField(inp.broker, inp.system, f);
      if (!sf || seen.has(sf.id)) continue;
      seen.add(sf.id);
      out.push(sf);
    }
  }
  return out;
}

/** The sidecar's advertised fields: EVERY canonical field (our sidecar can hold any type), each keyed to itself,
 *  unbounded length, nullable. This is what "turning on the sidecar exposes all the data types it advertises"
 *  means — the full canonical vocabulary becomes mappable via the built-in home. */
export function sidecarEnumeratedFields(): EnumeratedField[] {
  return FIELD_REGISTRY.map((f) => ({
    key: f.key, label: f.label, type: f.type, surface: true, store: true,
    sourceSystem: SIDECAR_BACKEND, sourceField: f.key, nullable: true,
    ...(f.maxLength !== undefined ? { maxLength: f.maxLength } : {}),
    ...(f.precision !== undefined ? { precision: f.precision } : {}),
    ...(f.options !== undefined ? { options: f.options } : {}),
    ...(f.pattern !== undefined ? { pattern: f.pattern } : {}),
  }));
}

/** The sidecar's superset input: fronted by the built-in broker, backend = sidecar. */
export const sidecarSupersetInput = (): SupersetInput => ({ broker: BUILTIN_BROKER, system: SIDECAR_BACKEND, fields: sidecarEnumeratedFields() });

/**
 * Build the mapping {@link FieldRef} for a picked superset entry — the admin selects a LIVE field and the native
 * id + home come from the entry (broker-derived, never hand-typed). Records the full triple: the UI element is
 * the mapping key; the ref carries the backend home + native field + the canonical `superset` it reconciles to.
 */
export function fieldRefFromSuperset(sf: SupersetField): { broker: string; backend: string; field: string; superset: string } {
  return { broker: sf.broker, backend: sf.system, field: sf.nativeField, superset: sf.canonicalKey };
}

/**
 * Derive the UI-field validation for a mapping from its fields' HOMES (roadmap §4.6): for each mapping entry,
 * find the live-superset field it points at (`<backend>:<nativeField>`) and inherit that backend's constraints
 * as a rule keyed by the UI element. Returns the rules PLUS the per-UI-element type (for the value evaluator).
 * Homeless / unresolved / no-longer-live fields contribute nothing — the UI simply can't validate what has no
 * live home. So the UI field always validates to exactly what its backend accepts.
 */
export function deriveMappingValidation(fields: Record<string, FieldRef>, superset: SupersetField[]): { rules: FieldValidationRule[]; typeByUi: Record<string, string> } {
  const byId = new Map(superset.map((s) => [s.id, s]));
  const rules: FieldValidationRule[] = [];
  const typeByUi: Record<string, string> = {};
  for (const [uiKey, ref] of Object.entries(fields)) {
    const backend = typeof ref === "string" ? undefined : ref.backend;
    const field = typeof ref === "string" ? ref : ref.field;
    if (!backend || !field) continue; // homeless / bare — no live home to inherit from
    const sf = byId.get(`${backend}:${field}`);
    if (!sf) continue; // the field isn't live+linked (backend gone) — nothing to validate against
    rules.push(deriveValidationRule(uiKey, sf));
    typeByUi[uiKey] = sf.type;
  }
  return { rules, typeByUi };
}
