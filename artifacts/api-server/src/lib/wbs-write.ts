import { resolveFieldTarget, BUILTIN_BROKER, SIDECAR_BACKEND, type FieldTarget, type FieldRef } from "./field-target";
import { mappingHome, type WbsFieldMapping } from "./wbs-mapping";

/**
 * WBS WRITE ROUTING (roadmap §4.6) — "data is entered in a SAP-like interface … some fields map to OpenProject
 * and some map to our sidecar." When the screen saves semantic field values, THIS splits them by each field's
 * resolved (broker, backend): fields that route to the built-in broker + sidecar are written to our own sealed
 * store; fields that route to an EXTERNAL backend are handed back as `external` (the broker write adapters are a
 * later slice — until then those are reported, never silently dropped). PURE: it plans the write; the route
 * applies the sidecar part and audits the rest.
 */

/** Whether a semantic key is one this mapping can carry (structure or financial). */
function keyRef(m: WbsFieldMapping, key: string): FieldRef | undefined {
  if (key === "id") return m.id;
  if (key === "name") return m.name;
  if (key === "parentId" || key === "status" || key === "responsible") return m[key];
  if (key === "budget" || key === "actual" || key === "commitment" || key === "wip" || key === "planned" || key === "currency") return m[key];
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
  /** Fields the mapping carries but that resolve to NO home — the admin must give each a home or remove it.
   *  Never written. */
  homeless: string[];
  /** Semantic keys with no mapping (ignored) — surfaced so the caller can warn. */
  unmapped: string[];
}

/**
 * Plan the write of `semanticValues` (semanticKey → value) under mapping `m`. Splits each provided field to the
 * sidecar (written locally), `external` (routed elsewhere, no adapter yet), or `homeless` (no home — never
 * written, surfaced for the admin to decide). The WBS id is the row key (`sidecarIdField`), not a writable field.
 */
export function planWbsWrite(m: WbsFieldMapping, semanticValues: Record<string, unknown>): WbsWritePlan {
  const home = mappingHome(m);
  const plan: WbsWritePlan = { sidecarIdField: m.joinField || m.id, sidecar: {}, external: [], homeless: [], unmapped: [] };
  for (const [key, value] of Object.entries(semanticValues)) {
    if (key === "id") continue; // the id is the row key, handled by the store, not a writable field
    const ref = keyRef(m, key);
    if (ref === undefined) { plan.unmapped.push(key); continue; }
    const target = resolveFieldTarget(ref, home);
    if (!target) { plan.homeless.push(key); continue; }
    if (isSidecar(target)) plan.sidecar[target.field] = value;
    else plan.external.push({ key, target, value });
  }
  return plan;
}
