import type { Request } from "express";
import { getBroker, contextFromReq } from "../broker";
import type { SchemaManifest } from "../broker/types";
import { FIELD_KEYS, ENTITY_KEYS, resolveCapabilities } from "./capabilities";
import { relationships as registryRelationships } from "./field-registry";

/**
 * Availability resolver — what the connected backend ACTUALLY surfaces, computed as
 * `superset ∩ (manifest if the backend provides one, else the static capability flags)`.
 *
 * The manifest path applies ONLY when a backend implements `describeSchema` — in practice
 * OmniProject's own stateful self-host DB, which owns its schema and can report exactly which
 * tables/fields/relationships exist and which are populated. Every ordinary SaaS backend (the
 * stateless-overlay default) has no manifest: data stays in the vendor and availability is
 * governed by the existing capability flags, so the resolver falls back cleanly. Admin/PMO
 * view-curation then layers on top of whatever this returns.
 */
export interface Availability {
  /** Where the surfaced set came from: a backend schema manifest, or the static capability flags. */
  source: "manifest" | "capabilities";
  /** Surfaced canonical field keys (what the UI should offer), in stable superset order. */
  fields: string[];
  /** Surfaced canonical entity keys (tables). */
  tables: string[];
  /** Relationship edges among entities. */
  relationships: { from: string; field: string; to: string }[];
}

const SUPERSET = new Set(FIELD_KEYS);
const ENTITIES = ENTITY_KEYS as readonly string[];
const TTL_MS = 30_000;
// Availability is a backend-level property (not per-user), so cache by broker kind with a short TTL.
const cache = new Map<string, { at: number; value: Availability }>();

/** Test seam: clear the short-TTL cache. */
export function __resetAvailabilityCacheForTest(): void {
  cache.clear();
}

/** Intersect a backend schema manifest with the superset; honour `populated` when present. */
export function availabilityFromManifest(m: SchemaManifest): Availability {
  // "Surface only what is populated": prefer the populated set when the backend reports one.
  const present = new Set((m.populated ?? m.fields).filter((k) => SUPERSET.has(k)));
  return {
    source: "manifest",
    fields: FIELD_KEYS.filter((k) => present.has(k)), // stable superset order
    tables: (m.tables ?? []).filter((t) => ENTITIES.includes(t)),
    relationships: (m.relationships ?? []).filter((r) => SUPERSET.has(r.field)),
  };
}

/** Fallback path: derive the surfaced set from the static capability flags. */
async function availabilityFromCapabilities(req: Request): Promise<Availability> {
  const caps = await resolveCapabilities(req);
  return {
    source: "capabilities",
    fields: FIELD_KEYS.filter((k) => caps.fields[k]?.surface),
    tables: ENTITIES.filter((e) => caps.entities[e]?.surface),
    relationships: registryRelationships()
      .filter((r) => caps.fields[r.field]?.surface)
      .map((r) => ({ from: "issue", field: r.field, to: r.references })),
  };
}

/**
 * Resolve availability for the active backend. Uses the backend's `describeSchema` manifest when it
 * provides one (the stateful-DB path), else falls back to the capability flags. Cached per backend
 * kind for a short TTL.
 */
export async function resolveAvailability(req: Request): Promise<Availability> {
  const broker = getBroker();
  const cached = cache.get(broker.kind);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const ctx = contextFromReq(req);
  const manifest = (await broker.describeSchema?.(ctx).catch(() => null)) ?? null;
  const value = manifest ? availabilityFromManifest(manifest) : await availabilityFromCapabilities(req);

  cache.set(broker.kind, { at: Date.now(), value });
  return value;
}
