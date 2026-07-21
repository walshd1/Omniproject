import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/**
 * Field-mapping data (roadmap §4.6) — the admin translation layer. `useLiveSuperset` is the set of fields an
 * admin may map a UI element onto RIGHT NOW: the union of every connected backend's advertised fields plus the
 * sidecar's canonical vocabulary when it's on, duplicates kept distinct, each carrying origin + type + limits.
 * `useResolvedMapping` is the effective mapping for a slot with its homeless fields + the validation each UI
 * field inherits from its home. The picker binds ONLY to the live superset, so an admin can never map onto a
 * field no active backend can serve.
 */

/** One mappable field: a single backend's field, reconciled to a canonical concept but kept distinct per backend. */
export interface SupersetField {
  id: string;
  canonicalKey: string;
  label: string;
  broker: string;
  system: string;
  nativeField: string;
  type: string;
  maxLength?: number;
  precision?: number;
  options?: string[];
  nullable?: boolean;
  canonical: boolean;
  group?: string;
}

/** A mapping field ref — the stored triple (home + native + the canonical superset it reconciles to). */
export interface FieldRef {
  broker?: string;
  backend?: string;
  field: string;
  superset?: string;
}

export interface ResolvedMapping {
  id: string;
  broker?: string;
  backend?: string;
  joinField?: string;
  fields: Record<string, FieldRef | string>;
  defaults?: Record<string, string>;
  /** Fields with no home — the admin must map them to a backend, the sidecar, or remove them. */
  homeless: string[];
  /** The validation each UI field inherits from its live home. */
  validation: { field: string; required?: boolean; min?: number; max?: number; options?: string[] }[];
}

const supersetKey = ["fields", "superset"] as const;

/** The live superset — every field mappable right now (connected backends + the sidecar). Manager+ on the API. */
export function useLiveSuperset() {
  return useQuery({
    queryKey: supersetKey,
    queryFn: () => getJson<{ fields: SupersetField[] }>("/api/fields/superset"),
    select: (d) => d.fields,
  });
}

/** The effective mapping for a slot in a project's scope: fields + homeless + inherited validation. */
export function useResolvedMapping(projectId: string | undefined, slot: string) {
  return useQuery({
    queryKey: ["mapping", projectId ?? null, slot] as const,
    queryFn: () => getJson<ResolvedMapping>(`/api/projects/${encodeURIComponent(projectId!)}/mapping/${encodeURIComponent(slot)}`),
    enabled: !!projectId && !!slot,
    retry: false,
  });
}

/** Build the stored mapping ref (the triple) from a picked live-superset entry — the native id + home come from
 *  the broker, never hand-typed. */
export function refFromSuperset(sf: SupersetField): FieldRef {
  return { broker: sf.broker, backend: sf.system, field: sf.nativeField, superset: sf.canonicalKey };
}
