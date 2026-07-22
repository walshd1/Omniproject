import { isForbiddenKey } from "./safe-json";
import {
  resolveFieldTarget, sanitizeFieldRef, sanitizeHomeId, targetKey, sameHome,
  BUILTIN_BROKER, SIDECAR_BACKEND,
  type FieldRef, type FieldTarget, type BrokerBackend,
} from "./field-target";
import { OMNISTORE_BACKEND } from "./omnistore-homing";
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
  /** COMPOSITION: the slot of a parent mapping this one is built on (see def-compose). The resolver folds the
   *  parent's fields underneath (child fields win, per key), so a mapping is a thin extension of a base. */
  extends?: string;
}

/** The mapping's EFFECTIVE home (broker and/or backend). The mapping's own declaration wins; a half it
 *  leaves absent is filled from `lastResort` when one is supplied (OmniStore-as-SoR-of-last-resort — see
 *  omnistore-homing), else stays absent so a field that still can't inherit a full home is homeless (an
 *  admin decision). With no `lastResort` this is exactly the mapping's declared home — unchanged. */
export function mappingHome(m: Pick<Mapping, "broker" | "backend">, lastResort?: BrokerBackend): Partial<BrokerBackend> {
  const broker = m.broker ?? lastResort?.broker;
  const backend = m.backend ?? lastResort?.backend;
  const home: Partial<BrokerBackend> = {};
  if (broker !== undefined) home.broker = broker;
  if (backend !== undefined) home.backend = backend;
  return home;
}

/** Resolve every field to a {@link FieldTarget}, inheriting the mapping's declared home. Fields that can't
 *  resolve to a full (broker, backend) are returned as `homeless` — the admin must give each a home (an external
 *  backend or our sidecar) or remove it. */
export function resolveMappingTargets(m: Mapping, lastResort?: BrokerBackend): { targets: Record<string, FieldTarget>; homeless: string[] } {
  const home = mappingHome(m, lastResort);
  const targets: Record<string, FieldTarget> = {};
  const homeless: string[] = [];
  for (const [key, ref] of Object.entries(m.fields)) {
    const t = resolveFieldTarget(ref, home);
    if (t) targets[key] = t; else homeless.push(key);
  }
  return { targets, homeless };
}

/** The native field name a ref carries (independent of its home) — for keying rows even when homeless. */
const refFieldName = (ref: FieldRef | undefined, fallback: string): string =>
  ref === undefined ? fallback : typeof ref === "string" ? ref : ref.field;

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
  if (o["extends"] !== undefined && o["extends"] !== null && o["extends"] !== "") {
    if (typeof o["extends"] !== "string" || isForbiddenKey(o["extends"])) throw new MappingError("mapping.extends must be a safe slot id");
    const ext = (o["extends"] as string).trim();
    if (ext === out.id) throw new MappingError("mapping.extends must not be the mapping's own slot");
    out.extends = ext;
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
    if (layer.extends !== undefined) out.extends = layer.extends;
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

// ── Generic projection + write planning (the "across the board" seam) ────────────────────────────────────────
// Any surface — a screen table, a form, a report — projects its rows through a mapping the SAME way WBS does:
// structure comes from the home bucket, each field is read from ITS (broker, backend) bucket joined by the row
// id. These are the generic primitives the generic `/mapping/:slot/rows` + write routes stand on.

type Src = Record<string, unknown>;
const asStr = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** Which semantic key is the row id (default `"id"`). */
export const mappingIdKey = (m: Mapping): string => (m.fields["id"] ? "id" : Object.keys(m.fields)[0] ?? "id");

/**
 * Project records (per-`(broker,backend)` bucket, keyed by {@link targetKey}) into rows of semantic values via a
 * mapping. The home bucket supplies the row set + its id; each field is read from its own bucket, joined by the
 * id (the join column in non-home buckets is `joinField`, defaulting to the id field's native name). Each output
 * row is `{ [idKey]: id, …semanticValues }` — exactly what a generic table panel binds to. A bare `Src[]` is the
 * home bucket (the common single-backend case).
 */
export function projectMappingRows(sources: Src[] | Record<string, Src[]>, m: Mapping, lastResort?: BrokerBackend): Record<string, unknown>[] {
  const home = mappingHome(m, lastResort);
  const idKey = mappingIdKey(m);
  const idTarget = resolveFieldTarget(m.fields[idKey] ?? idKey, home);
  if (!idTarget) return []; // homeless structure — nothing to read; surfaced via resolveMappingTargets
  const structureKey = targetKey(idTarget);
  const buckets: Record<string, Src[]> = Array.isArray(sources) ? { [structureKey]: sources } : sources;
  const rowsOf = (key: string): Src[] => (buckets[key] ?? []).filter((r) => r && typeof r === "object");
  const joinField = m.joinField || idTarget.field;

  // Index every non-structure bucket by its join id.
  const nonHomeIndex = new Map<string, Map<string, Src>>();
  for (const [key, rows] of Object.entries(buckets)) {
    if (key === structureKey) continue;
    const byId = new Map<string, Src>();
    for (const r of rows) { if (r && typeof r === "object") { const jid = asStr(r[joinField]); if (jid) byId.set(jid, r); } }
    nonHomeIndex.set(key, byId);
  }

  const out: Record<string, unknown>[] = [];
  for (const r of rowsOf(structureKey)) {
    const id = asStr(r[idTarget.field]);
    if (!id) continue;
    const row: Record<string, unknown> = { [idKey]: id };
    for (const [key, ref] of Object.entries(m.fields)) {
      if (key === idKey) continue;
      const t = resolveFieldTarget(ref, home);
      if (!t) { row[key] = undefined; continue; }   // homeless field → no source, surfaced separately
      const src = sameHome(t, idTarget) ? r : nonHomeIndex.get(targetKey(t))?.get(id);
      row[key] = src ? src[t.field] : undefined;
    }
    out.push(row);
  }
  return out;
}

export interface MappingWritePlan {
  /** The join id field to key the sidecar row on. */
  sidecarIdField: string;
  /** Native field name → value for the sidecar-routed fields. */
  sidecar: Record<string, unknown>;
  /** Fields routed to an external (broker, backend) with no write adapter yet — reported, not dropped. */
  external: { key: string; target: FieldTarget; value: unknown }[];
  /** Fields the mapping declares but that resolve to NO home — the admin must give each a home or remove it.
   *  Never written anywhere. */
  homeless: string[];
  /** Semantic keys with no mapping (ignored) — surfaced so the caller can warn. */
  unmapped: string[];
}

/** A field whose home is the built-in broker's own local store — the sidecar OR OmniStore (the SoR-of-last
 *  resort). Both are the first-party local home the generic slot store persists, so both are written locally
 *  rather than reported as an un-adapted external backend. */
const isLocalBuiltinTarget = (t: FieldTarget): boolean =>
  t.broker === BUILTIN_BROKER && (t.backend === SIDECAR_BACKEND || t.backend === OMNISTORE_BACKEND);

/**
 * Plan a generic write of `values` (semanticKey → value) under mapping `m`: split each provided field to the
 * local built-in store (sidecar or OmniStore — written locally), `external` (routed elsewhere, no adapter
 * yet), or `homeless` (no home — never written, surfaced for the admin to decide). When a `lastResort` home
 * is supplied (OmniStore enabled), an orphan field inherits it and so lands in the local `sidecar` bucket
 * rather than staying homeless. The id key is the row key, not a writable field.
 */
export function planMappingWrite(m: Mapping, values: Record<string, unknown>, lastResort?: BrokerBackend): MappingWritePlan {
  const home = mappingHome(m, lastResort);
  const idKey = mappingIdKey(m);
  const idField = refFieldName(m.fields[idKey], idKey);
  const plan: MappingWritePlan = { sidecarIdField: m.joinField || idField, sidecar: {}, external: [], homeless: [], unmapped: [] };
  for (const [key, value] of Object.entries(values)) {
    if (key === idKey) continue;
    const ref = m.fields[key];
    if (ref === undefined) { plan.unmapped.push(key); continue; }
    const t = resolveFieldTarget(ref, home);
    if (!t) { plan.homeless.push(key); continue; }
    if (isLocalBuiltinTarget(t)) plan.sidecar[t.field] = value;
    else plan.external.push({ key, target: t, value });
  }
  return plan;
}
