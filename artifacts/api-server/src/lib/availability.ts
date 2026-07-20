import type { Request } from "express";
import { getBackend } from "@workspace/backend-catalogue";
import { getBroker, contextFromReq } from "../broker";
import type { SchemaManifest } from "../broker/types";
import { FIELD_KEYS, ENTITY_KEYS, resolveCapabilities } from "./capabilities";
import { relationships as registryRelationships, FIELD_REGISTRY } from "./field-registry";
import { getSettings } from "./settings";
import { readConfigCollection } from "./scoped-config";

/**
 * Availability resolver — what the connected backend ACTUALLY surfaces, then trimmed by admin/PMO
 * view-curation:
 *
 *   available = superset ∩ (manifest if the backend provides one, else the static capability flags)
 *   fields    = available − settings.hiddenFields   (the net set the UI should offer)
 *
 * The manifest path applies ONLY when a backend implements `describeSchema` — in practice
 * OmniProject's own stateful self-host DB, which owns its schema and reports exactly which
 * tables/fields/relationships exist and which are populated. Every ordinary SaaS backend (the
 * stateless-overlay default) has no manifest: data stays in the vendor and availability is governed
 * by the existing capability flags, so the resolver falls back cleanly. Curation (hiddenFields)
 * then trims that — it can only HIDE what's available, never reveal what the backend lacks.
 */
export interface Availability {
  /** Where the backend set came from: a schema manifest, or the static capability flags. */
  source: "manifest" | "capabilities";
  /** Net VISIBLE canonical field keys (available − hidden), in stable superset order. */
  fields: string[];
  /** The full backend-available field set BEFORE curation (what the curation panel can hide). */
  available: string[];
  /** The curation list actually in effect (hiddenFields ∩ available). */
  hidden: string[];
  /** Surfaced canonical entity keys (tables). */
  tables: string[];
  /** Relationship edges among entities (curated fields removed). */
  relationships: { from: string; field: string; to: string }[];
}

/** The backend-available set (pre-curation) — the part worth caching per backend kind. */
interface BackendAvailability {
  source: "manifest" | "capabilities";
  available: string[];
  tables: string[];
  relationships: { from: string; field: string; to: string }[];
}

const SUPERSET = new Set(FIELD_KEYS);
const ENTITIES = ENTITY_KEYS as readonly string[];
const CORE_KEYS = FIELD_REGISTRY.filter((f) => f.core).map((f) => f.key);

/**
 * When the gateway is pointed at ONE catalogued vendor (settings.backendSource is a backend id, not
 * "all") that DECLARES its supported `fieldKeys`, that declaration is authoritative: the picker lights
 * up exactly the fields that backend carries (core ∪ its fieldKeys) instead of the whole capability
 * domain. Returns null for "all"/unknown backends or a vendor that declares nothing — the caller then
 * falls back to the coarse domain-derived set (unchanged behaviour).
 */
function declaredVendorFields(): Set<string> | null {
  const src = getSettings().backendSource;
  if (!src || src === "all") return null;
  const keys = getBackend(src)?.fieldKeys;
  if (!keys || keys.length === 0) return null;
  return new Set([...CORE_KEYS, ...keys.filter((k) => SUPERSET.has(k))]);
}
const TTL_MS = 30_000;
// The BACKEND layer is a backend-level property (not per-user), so cache by broker kind with a
// short TTL. Curation (settings.hiddenFields) is applied fresh on every call so it takes effect at
// once — it's a cheap set subtraction.
const cache = new Map<string, { at: number; value: BackendAvailability }>();

/** Test seam: clear the short-TTL cache. */
export function __resetAvailabilityCacheForTest(): void {
  cache.clear();
}

/** Intersect a backend schema manifest with the superset; honour `populated` when present. */
export function availabilityFromManifest(m: SchemaManifest): BackendAvailability {
  // "Surface only what is populated": prefer the populated set when the backend reports one.
  const present = new Set((m.populated ?? m.fields).filter((k) => SUPERSET.has(k)));
  return {
    source: "manifest",
    available: FIELD_KEYS.filter((k) => present.has(k)), // stable superset order
    tables: (m.tables ?? []).filter((t) => ENTITIES.includes(t)),
    relationships: (m.relationships ?? []).filter((r) => SUPERSET.has(r.field)),
  };
}

/** Fallback path: derive the surfaced set from the static capability flags — or, when the gateway is
 *  pointed at a single vendor that declares its own fieldKeys, from that authoritative declaration. */
async function availabilityFromCapabilities(req: Request): Promise<BackendAvailability> {
  const caps = await resolveCapabilities(req);
  const declared = declaredVendorFields();
  const surfaced = (k: string): boolean => (declared ? declared.has(k) : !!caps.fields[k]?.surface);
  const available = FIELD_KEYS.filter(surfaced);
  const availableSet = new Set(available);
  return {
    source: "capabilities",
    available,
    tables: ENTITIES.filter((e) => caps.entities[e]?.surface),
    relationships: registryRelationships()
      .filter((r) => availableSet.has(r.field))
      .map((r) => ({ from: "issue", field: r.field, to: r.references })),
  };
}

/** Apply admin/PMO curation (settings.hiddenFields) to a backend-available set. Pure. */
export function applyCuration(backend: BackendAvailability, hiddenFields: string[]): Availability {
  const hide = new Set(hiddenFields);
  const hidden = backend.available.filter((k) => hide.has(k)); // only what's actually available
  return {
    source: backend.source,
    available: backend.available,
    hidden,
    fields: backend.available.filter((k) => !hide.has(k)),
    tables: backend.tables,
    relationships: backend.relationships.filter((r) => !hide.has(r.field)),
  };
}

/**
 * Resolve availability for the active backend, trimmed by admin/PMO curation. The BACKEND layer
 * (superset ∩ manifest-or-capabilities) is cached per backend kind for a short TTL; the curation
 * (settings.hiddenFields) is applied fresh each call so toggling it takes effect at once.
 */
export async function resolveAvailability(req: Request): Promise<Availability> {
  const broker = getBroker();
  // The capability path now also depends on which single vendor (if any) is configured, so the
  // backendSource is part of the cache identity — otherwise switching backends would serve a stale set.
  const key = `${broker.kind}::${getSettings().backendSource ?? "all"}`;
  let backend = cache.get(key);
  if (!backend || Date.now() - backend.at >= TTL_MS) {
    const ctx = contextFromReq(req);
    const manifest = (await broker.describeSchema?.(ctx).catch(() => null)) ?? null;
    const value = manifest ? availabilityFromManifest(manifest) : await availabilityFromCapabilities(req);
    backend = { at: Date.now(), value };
    cache.set(key, backend);
  }
  return applyCuration(backend.value, readConfigCollection<string[]>("hidden-fields", []));
}
