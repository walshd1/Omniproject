import { FIELD_REGISTRY, CANONICAL_FIELD_KEYS, type FieldDescriptor } from "@workspace/backend-catalogue";
import type { EnumeratedField } from "./field-registry";
import { BUILTIN_BROKER, SIDECAR_BACKEND } from "./field-target";

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
  nullable?: boolean;
  /** Whether the canonical concept is in the registry (`true`) or a backend custom/unknown field (`false`). */
  canonical: boolean;
  group?: string;
}

/** One connected backend's advertised fields. */
export interface SupersetInput { system: string; fields: EnumeratedField[] }

const REGISTRY_BY_KEY = new Map<string, FieldDescriptor>(FIELD_REGISTRY.map((f) => [f.key, f]));

/** Project one backend's enumerated field into a superset entry (canonical label/group when the key is known). */
function toSupersetField(system: string, f: EnumeratedField): SupersetField | null {
  const native = f.sourceField || f.key;
  if (!f.key || !native) return null;
  const canonicalKey = f.key;
  const canonical = CANONICAL_FIELD_KEYS.has(canonicalKey);
  const desc = REGISTRY_BY_KEY.get(canonicalKey);
  const out: SupersetField = {
    id: `${system}:${native}`,
    canonicalKey,
    label: f.label || desc?.label || canonicalKey,
    system,
    nativeField: native,
    type: f.type || desc?.type || "string",
    canonical,
  };
  if (desc?.group) out.group = desc.group;
  if (f.maxLength !== undefined) out.maxLength = f.maxLength;
  if (f.precision !== undefined) out.precision = f.precision;
  if (f.options !== undefined) out.options = f.options;
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
      const sf = toSupersetField(inp.system, f);
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
  }));
}

/** The sidecar's superset input, labelled with the built-in broker's sidecar system id. */
export const sidecarSupersetInput = (): SupersetInput => ({ system: SIDECAR_BACKEND, fields: sidecarEnumeratedFields() });

/** The built-in broker id every sidecar-sourced superset field is homed under (for the mapping's `(broker, backend)`). */
export const SIDECAR_SUPERSET_BROKER = BUILTIN_BROKER;
