/**
 * MAPPING registry — the shipped CORE field-mapping defs (roadmap §4.6). Like reports/screens/methodologies,
 * mappings are now authored as JSON (one file per slot under assets/mappings/<id>.json) and embedded by
 * gen-mappings — NOT hand-written TypeScript constants. This closes the last code/data violation: a mapping is
 * DATA in the system JSON store, not engine code.
 *
 * A CORE mapping ships the all-in-one home (built-in broker + sidecar backend) so a slot resolves out of the
 * box; every scope above (org → programme → project → user) overrides per field through the importer. The
 * gateway both SEEDS these into the system def store and uses this catalogue as the store-off fallback layer —
 * one JSON source for both paths.
 *
 * Mappings are METHODOLOGY-NEUTRAL: a slot is raw data plumbing. The agile (or any) tag lives on the
 * screen/report defs that render a slot, never on the slot itself.
 */
import { MAPPINGS_DATA } from "./mappings.generated";

/** One field address in a mapping: a native field name (home = the mapping's broker/backend), or an explicit
 *  (broker, backend, field) with the canonical superset key it reconciles to. */
export type MappingFieldRef = string | { broker?: string; backend?: string; field: string; superset?: string };

/** A shipped CORE field-mapping def for one slot. Structural mirror of the gateway's `Mapping` (the gateway's
 *  `sanitizeMapping` is the authority); kept loose here so the catalogue package stays dependency-free. */
export interface MappingDef {
  /** The slot id. */
  id: string;
  /** Human label (the seeded def name). */
  label: string;
  /** Default home for fields with no per-field override. */
  broker?: string;
  backend?: string;
  /** The row id column (defaults to the id field's native name). */
  joinField?: string;
  /** semanticKey → address. */
  fields: Record<string, MappingFieldRef>;
  /** Literal default values by semanticKey. */
  defaults?: Record<string, string>;
}

/** Every shipped CORE mapping, id-sorted. Authored as JSON under assets/mappings/<id>.json and embedded by
 *  gen-mappings (drift-guarded in CI). */
export const MAPPINGS: MappingDef[] = [...MAPPINGS_DATA].sort((a, b) => a.id.localeCompare(b.id));

const byId = new Map(MAPPINGS.map((m) => [m.id, m]));

/** One CORE mapping by slot id, or undefined. */
export function getMappingDef(id: string): MappingDef | undefined {
  return byId.get(id);
}

/** All CORE mappings (a defensive copy). */
export function mappingCatalogue(): MappingDef[] {
  return MAPPINGS.map((m) => ({ ...m }));
}
