/**
 * Field registry (gateway view) — the reconcile / validate behaviour over the
 * canonical field vocabulary. The vocabulary itself (the field DATA + its types)
 * now lives BELOW the seam as JSON in the catalogue (`field-vocabulary.ts`, authored
 * in `assets/fields.json`, drift-guarded) with the other canonical vocabularies;
 * this module re-exports it so every existing `../lib/field-registry` import keeps
 * working, and adds the gateway-only behaviour: when a backend is wired in, its API
 * is enumerated and each field reconciled against the registry (known ⇒ wired
 * automatically; unknown ⇒ reported as "new" so the vocabulary is extended
 * deliberately). Extending the vocabulary is now a JSON edit, not a code edit.
 */
export { FIELD_REGISTRY, CANONICAL_FIELD_KEYS } from "@workspace/backend-catalogue";
export type { FieldType, FieldGroup, FieldDescriptor } from "@workspace/backend-catalogue";

import { FIELD_REGISTRY, CANONICAL_FIELD_KEYS, type FieldDescriptor } from "@workspace/backend-catalogue";

/** A field a backend reports it can expose, from API enumeration during wiring. */
export interface EnumeratedField {
  key: string;
  label?: string;
  type?: string;
  surface?: boolean;
  store?: boolean;
  /** If the backend's API schema says this field references another entity. */
  references?: string;
  /** The system of record this field is read from (e.g. "jira", "openproject").
   *  Lets the UI show granular lineage: "this canonical field ← that backend." */
  sourceSystem?: string;
  /** The backend's NATIVE field name/id this canonical field maps from (e.g.
   *  "duedate", "customfield_10016") — supplied by the broker/workflow, so the
   *  overlay can say exactly which backend field a value came from. */
  sourceField?: string;
}

export interface FieldReconciliation {
  /** Enumerated fields already in the canonical registry — wired automatically. */
  known: string[];
  /** Enumerated fields NOT in the registry — must be added to the registry to be
   *  first-class, or they stay carried as opaque extension fields. */
  unknown: string[];
  /** Canonical fields this backend did not enumerate — informational (the UI
   *  will simply gate them off for this backend). */
  missing: string[];
}

/**
 * Diff an enumerated backend API against the canonical registry. The `unknown`
 * list is the actionable output: each is a candidate to add to FIELD_REGISTRY
 * (and the contract) so the new system of record is fully understood.
 */
export function reconcileFields(enumerated: EnumeratedField[]): FieldReconciliation {
  const known: string[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const f of enumerated) {
    if (!f.key || seen.has(f.key)) continue;
    seen.add(f.key);
    (CANONICAL_FIELD_KEYS.has(f.key) ? known : unknown).push(f.key);
  }
  const missing = [...CANONICAL_FIELD_KEYS].filter((k) => !seen.has(k));
  return { known, unknown, missing };
}

/**
 * The discovered NON-canonical fields, with their metadata preserved, deduped by
 * key. These are exactly the tenant/custom fields a backend's describe surfaces
 * that the registry doesn't model — carried through verbatim as gated custom
 * fields (`Issue.customFields`) so ANY field a backend captures lights up without
 * a registry edit. Type defaults to "string" when the backend doesn't say.
 */
export function customFieldsFrom(enumerated: EnumeratedField[]): EnumeratedField[] {
  const out: EnumeratedField[] = [];
  const seen = new Set<string>();
  for (const f of enumerated) {
    if (!f.key || seen.has(f.key) || CANONICAL_FIELD_KEYS.has(f.key)) continue;
    seen.add(f.key);
    out.push({ key: f.key, label: f.label ?? f.key, type: f.type ?? "string", surface: f.surface ?? true, store: f.store ?? false, ...(f.references ? { references: f.references } : {}), ...(f.sourceSystem ? { sourceSystem: f.sourceSystem } : {}), ...(f.sourceField ? { sourceField: f.sourceField } : {}) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Relationships — how fields/entities relate, so creation dialogs can enforce
// the backend's actual model (not just per-field validity).
// ---------------------------------------------------------------------------

/** A "belongs to" relationship: `field` on an item points at entity `references`. */
export interface RelationshipEdge {
  field: string;
  references: string; // entity key
  kind: "belongs_to";
}

/** Derive the known relationship model from the registry's reference fields. */
export function relationships(): RelationshipEdge[] {
  return FIELD_REGISTRY.filter((f) => f.type === "reference" && f.references).map((f) => ({
    field: f.key,
    references: f.references!,
    kind: "belongs_to" as const,
  }));
}

/**
 * Best-effort discovery of relationships among *unknown* (newly enumerated)
 * fields. Explicit `references` from the backend's API schema win; otherwise a
 * conservative heuristic flags `<entity>Id` / `<entity>Ref` keys that match a
 * known entity. These are **candidates for confirmation**, never auto-applied —
 * the registry is still extended by a deliberate edit.
 */
export function inferRelationshipCandidates(
  enumerated: EnumeratedField[],
  entityKeys: readonly string[],
): RelationshipEdge[] {
  const out: RelationshipEdge[] = [];
  const entities = new Set(entityKeys.map((e) => e.toLowerCase()));
  for (const f of enumerated) {
    if (CANONICAL_FIELD_KEYS.has(f.key)) continue; // only reason about new fields
    if (f.references && entities.has(f.references.toLowerCase())) {
      out.push({ field: f.key, references: f.references, kind: "belongs_to" });
      continue;
    }
    const m = /^(.*?)(?:Id|Ref|Key)$/.exec(f.key);
    if (m && m[1] && entities.has(m[1].toLowerCase())) {
      out.push({ field: f.key, references: m[1].toLowerCase(), kind: "belongs_to" });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation — enforce required fields and referential integrity on create/update,
// so the add-project / add-programme dialogs can't violate the backend's model.
// ---------------------------------------------------------------------------

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validate an entity input against the registry: required fields present, and
 * reference fields point at an entity id that actually exists (referential
 * integrity). `knownRefs` maps an entity key to the set of valid ids in context.
 * Returns [] when valid. Authoritative on the gateway; the SPA dialog mirrors it
 * from the same descriptors for instant feedback.
 */
export function validateEntityInput(
  input: Record<string, unknown>,
  descriptors: FieldDescriptor[],
  knownRefs: Record<string, ReadonlySet<string>> = {},
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const d of descriptors) {
    const value = input[d.key];
    const empty = value == null || value === "" || (Array.isArray(value) && value.length === 0);
    if (d.required && empty) {
      errors.push({ field: d.key, message: `${d.label} is required` });
      continue;
    }
    if (d.type === "reference" && d.references && !empty) {
      const valid = knownRefs[d.references];
      if (valid && !valid.has(String(value))) {
        errors.push({ field: d.key, message: `${d.label} must reference an existing ${d.references}` });
      }
    }
  }
  return errors;
}
