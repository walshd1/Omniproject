import { resolveFieldTarget, BUILTIN_BROKER, SIDECAR_BACKEND, type FieldTarget } from "./field-target";
import { mappingHome, type WbsFieldMapping } from "./wbs-mapping";

/**
 * WBS WRITE ROUTING (roadmap §4.6) — "data is entered in a SAP-like interface … some fields map to OpenProject
 * and some map to our sidecar." When the screen saves semantic field values, THIS splits them by each field's
 * resolved (broker, backend): fields that route to the built-in broker + sidecar are written to our own sealed
 * store; fields that route to an EXTERNAL backend are handed back as `external` (the broker write adapters are a
 * later slice — until then those are reported, never silently dropped). PURE: it plans the write; the route
 * applies the sidecar part and audits the rest.
 */

/** The native field name a semantic key maps to at the mapping's home, or its own (broker, backend). */
function targetForKey(m: WbsFieldMapping, key: string): FieldTarget | undefined {
  const home = mappingHome(m);
  if (key === "id") return { ...home, field: m.id };
  if (key === "name") return { ...home, field: m.name };
  if (key === "parentId" || key === "status" || key === "responsible") {
    const f = m[key];
    return f ? { ...home, field: f } : undefined;
  }
  if (key === "budget" || key === "actual" || key === "commitment" || key === "wip" || key === "planned" || key === "currency") {
    const ref = m[key];
    return ref !== undefined ? resolveFieldTarget(ref, home) : undefined;
  }
  return undefined;
}

const isSidecar = (t: FieldTarget): boolean => t.broker === BUILTIN_BROKER && t.backend === SIDECAR_BACKEND;

export interface WbsWritePlan {
  /** The join id field name to key the sidecar row on (`joinField` or the mapping's id field). */
  sidecarIdField: string;
  /** Native field name → value to write into the sidecar row (the sidecar-routed fields). */
  sidecar: Record<string, unknown>;
  /** Fields routed to an external (broker, backend) that has no write adapter yet — reported, not dropped. */
  external: { key: string; target: FieldTarget; value: unknown }[];
  /** Semantic keys with no mapping (ignored) — surfaced so the caller can warn. */
  unmapped: string[];
}

/**
 * Plan the write of `semanticValues` (semanticKey → value) under mapping `m`. Splits each provided field to the
 * sidecar (written locally) or `external` (routed elsewhere, no adapter yet). The WBS id is the row key applied
 * by the store (`sidecarIdField`), not a writable field, so a sidecar-backed WBS is created from a first save.
 */
export function planWbsWrite(m: WbsFieldMapping, semanticValues: Record<string, unknown>): WbsWritePlan {
  const plan: WbsWritePlan = { sidecarIdField: m.joinField || m.id, sidecar: {}, external: [], unmapped: [] };
  for (const [key, value] of Object.entries(semanticValues)) {
    if (key === "id") continue; // the id is the row key, handled by the store, not a writable field
    const target = targetForKey(m, key);
    if (!target) { plan.unmapped.push(key); continue; }
    if (isSidecar(target)) plan.sidecar[target.field] = value;
    else plan.external.push({ key, target, value });
  }
  return plan;
}
