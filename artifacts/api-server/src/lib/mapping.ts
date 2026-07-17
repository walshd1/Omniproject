import { isForbiddenKey } from "./safe-json";
import {
  resolveFieldTarget, sanitizeFieldRef, sanitizeHomeId, BUILTIN_HOME,
  type FieldRef, type FieldTarget, type BrokerBackend,
} from "./field-target";
import type { FieldRoute } from "./field-routing";

/**
 * MAPPING — the first-class data-routing object (roadmap §4.6, "mappings become another first-class object").
 *
 * A mapping binds a set of SEMANTIC field keys (what a screen speaks: `wbs`, `budget`, `status`, or any
 * admin-named UI element) to FIELD TARGETS — each exactly one (broker, backend) + native field, via the shared
 * `field-target` spine. It is authored through the ONE importer (`kind: "mapping"`), sealed + scope-resolved
 * exactly like screens / forms / reports: a shipped core beneath, then org → programme → project → user, merged
 * PER FIELD (nearest wins) so a project can retarget one field and inherit the rest.
 *
 * This GENERALISES `field-routing`'s org-only `FieldRoute[]` (one field → one broker → one UI element) into a
 * scope-overridable object, and subsumes it: `mappingFromFieldRoutes` bridges the legacy org routing in as the
 * lowest customer layer, so existing routing keeps working through the one model.
 *
 * The mapping's `home` (`broker`/`backend`) is the default every bare-field-name inherits; absent ⇒ the
 * built-in broker + sidecar backend (the all-in-one default). PURE: shape + resolve, no I/O.
 */
export interface Mapping {
  /** The slot this mapping fills (e.g. `"wbs"`) — its addressable id in the def store. */
  id: string;
  /** The home broker every field inherits when it names no broker. Absent ⇒ built-in. */
  broker?: string;
  /** The home backend every field inherits when it names no backend. Absent ⇒ sidecar. */
  backend?: string;
  /** The field carrying the join id in NON-home sources (defaults to a consumer's own id key). */
  joinField?: string;
  /** semanticKey → address. A partial (scope-override) mapping may set only the keys it changes. */
  fields: Record<string, FieldRef>;
  /** Consumer-specific literal defaults (e.g. WBS `currency`) — passthrough, not routed. */
  defaults?: Record<string, string>;
}

/** The mapping's home (broker, backend) — its declared default, else the built-in fallback. */
export function mappingHome(m: Pick<Mapping, "broker" | "backend">): BrokerBackend {
  return { broker: m.broker ?? BUILTIN_HOME.broker, backend: m.backend ?? BUILTIN_HOME.backend };
}

/** Resolve every field to a full {@link FieldTarget}, inheriting the mapping's home. */
export function resolveMappingTargets(m: Mapping): Record<string, FieldTarget> {
  const home = mappingHome(m);
  const out: Record<string, FieldTarget> = {};
  for (const [key, ref] of Object.entries(m.fields)) out[key] = resolveFieldTarget(ref, home);
  return out;
}

export class MappingError extends Error {
  constructor(message: string) { super(message); this.name = "MappingError"; }
}

/**
 * Validate + coerce an authored mapping (the importer choke point for `kind: "mapping"`). Requires a safe `id`
 * (the slot); `fields` is a map of safe semantic key → {@link FieldRef}; `broker`/`backend`/`joinField` are
 * optional safe ids; `defaults` is a map of safe key → string literal. A scope-OVERRIDE may carry an empty (or
 * absent) `fields` — the merge fills the rest. Throws {@link MappingError}.
 */
export function sanitizeMapping(raw: unknown): Mapping {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new MappingError("mapping must be an object");
  const o = raw as Record<string, unknown>;
  const id = o["id"];
  if (typeof id !== "string" || !id.trim() || isForbiddenKey(id)) throw new MappingError("mapping.id (the slot) is required and must be a safe id");
  const out: Mapping = { id: id.trim(), fields: {} };
  try {
    const broker = sanitizeHomeId("mapping.broker", o["broker"]);
    if (broker !== undefined) out.broker = broker;
    const backend = sanitizeHomeId("mapping.backend", o["backend"]);
    if (backend !== undefined) out.backend = backend;
  } catch (e) { throw new MappingError(e instanceof Error ? e.message : "invalid home"); }
  if (o["joinField"] !== undefined && o["joinField"] !== null && o["joinField"] !== "") {
    if (typeof o["joinField"] !== "string" || isForbiddenKey(o["joinField"])) throw new MappingError("mapping.joinField must be a safe field name");
    out.joinField = (o["joinField"] as string).trim();
  }
  const fields = o["fields"];
  if (fields !== undefined && fields !== null) {
    if (typeof fields !== "object" || Array.isArray(fields)) throw new MappingError("mapping.fields must be an object of semanticKey → address");
    for (const [key, v] of Object.entries(fields as Record<string, unknown>)) {
      if (isForbiddenKey(key) || !key.trim()) throw new MappingError(`mapping.fields key "${key}" is not a safe field key`);
      try {
        const ref = sanitizeFieldRef(`mapping.fields.${key}`, v);
        if (ref !== undefined) out.fields[key] = ref;
      } catch (e) { throw new MappingError(e instanceof Error ? e.message : `invalid mapping.fields.${key}`); }
    }
  }
  const defaults = o["defaults"];
  if (defaults !== undefined && defaults !== null) {
    if (typeof defaults !== "object" || Array.isArray(defaults)) throw new MappingError("mapping.defaults must be an object of literal values");
    const d: Record<string, string> = {};
    for (const [key, v] of Object.entries(defaults as Record<string, unknown>)) {
      if (isForbiddenKey(key) || !key.trim()) throw new MappingError(`mapping.defaults key "${key}" is not safe`);
      if (typeof v === "string") d[key] = v;
    }
    if (Object.keys(d).length) out.defaults = d;
  }
  return out;
}

/**
 * Merge mapping layers (base → nearest). Home (`broker`/`backend`/`joinField`) and each `fields`/`defaults`
 * entry are overridden per-key by the nearest layer that sets them — so a higher scope changes only what it
 * names. Returns the merged whole mapping (id from the first layer that carries one). Layers are assumed already
 * sanitised.
 */
export function mergeMappings(layers: Mapping[]): Mapping {
  const out: Mapping = { id: "", fields: {} };
  const defaults: Record<string, string> = {};
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.id && !out.id) out.id = layer.id;
    if (layer.broker !== undefined) out.broker = layer.broker;
    if (layer.backend !== undefined) out.backend = layer.backend;
    if (layer.joinField !== undefined) out.joinField = layer.joinField;
    for (const [k, v] of Object.entries(layer.fields)) out.fields[k] = v;
    if (layer.defaults) for (const [k, v] of Object.entries(layer.defaults)) defaults[k] = v;
  }
  if (Object.keys(defaults).length) out.defaults = defaults;
  return out;
}

/**
 * Bridge the legacy org `fieldRouting` (an array of `{ uiElement, vendor, broker, sourceField }`) into a
 * generic {@link Mapping} — each route becomes `fields[uiElement] = { broker, backend: vendor, field:
 * sourceField }`. This is how the first-class mapping SUBSUMES `field-routing`: the org's admin-declared routing
 * folds in as one mapping layer, so nothing about it is lost when resolution moves to the mapping model.
 */
export function mappingFromFieldRoutes(routes: readonly FieldRoute[], slot: string): Mapping {
  const fields: Record<string, FieldRef> = {};
  for (const r of routes) {
    if (!r || isForbiddenKey(r.uiElement)) continue;
    fields[r.uiElement] = { broker: r.broker, backend: r.vendor, field: r.sourceField };
  }
  return { id: slot, fields };
}
