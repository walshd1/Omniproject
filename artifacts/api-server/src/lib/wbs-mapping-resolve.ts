import { getArtifact, putArtifact, type ArtifactScope } from "./artifact-store";
import { sanitizeWbsMapping, WbsMappingError, type WbsFieldMapping } from "./wbs-mapping";

/**
 * SCOPE-OVERRIDABLE WBS MAPPINGS (roadmap §4.6) — "we could provide some core mappings in JSON in the system
 * store and allow users, PMs, programme managers and orgs to override in our already established pattern."
 *
 * The WBS field mapping (which backend/sidecar field feeds each semantic cost-screen field) is resolved exactly
 * like screens / reports / def-bindings: a shipped CORE layer beneath, then org → programme → project → user
 * overrides, NEAREST WINS. The merge is PER FIELD (a shallow spread), so a project can override just `budget`'s
 * target while inheriting everything else from the org's or the core mapping — you don't restate the whole
 * mapping to change one field. The core layer ships from OUR source (`CORE_WBS_MAPPINGS`), like the system defs.
 *
 * A `slot` names WHICH mapping (default `"wbs"`), so an org can keep one house mapping for every project and a
 * single project can still diverge. Per-scope overrides live in the sealed artifact store — a `project` override
 * physically sits in THAT project's scope file, so a PM's change is confined to their project by construction.
 *
 * PURE resolution (merge + sanitize); storage helpers are thin wrappers over the sealed store.
 */

/** The default mapping slot when a screen/route doesn't name one. */
export const DEFAULT_WBS_SLOT = "wbs";

/**
 * The shipped CORE mappings (the system layer) — JSON we bundle, overridable by every scope above. The default
 * `"wbs"` mapping assumes an ERP/broker that already speaks WBS field names (the SAP fixtures + demo broker do),
 * so out of the box the cost screen renders with no org configuration; a customer on OpenProject/Jira/sidecar
 * overrides the fields (and their targets) at whatever scope they choose.
 */
export const CORE_WBS_MAPPINGS: Record<string, WbsFieldMapping> = {
  [DEFAULT_WBS_SLOT]: {
    id: "id", name: "name", parentId: "parentId", status: "status", responsible: "responsible",
    budget: "budget", actual: "actual", commitment: "commitment", wip: "wip", planned: "planned",
    currency: "currency", currencyDefault: "GBP",
  },
};

/** The layers consulted for a slot, base → nearest. Any layer may be a PARTIAL mapping (it overrides only the
 *  fields it names); the merged result must still be a valid whole mapping (id + name present). */
export interface WbsMappingLayers {
  /** The shipped core (defaults to `CORE_WBS_MAPPINGS[slot]`). */
  core?: Partial<WbsFieldMapping>;
  org?: Partial<WbsFieldMapping>;
  programme?: Partial<WbsFieldMapping>;
  project?: Partial<WbsFieldMapping>;
  user?: Partial<WbsFieldMapping>;
}

/** The order layers are applied — later overrides earlier (nearest wins). */
const LAYER_ORDER: (keyof WbsMappingLayers)[] = ["core", "org", "programme", "project", "user"];

/**
 * Merge the layers for a slot (shallow, per-field, nearest wins) and validate the result through the same
 * sanitiser the importer uses. Throws {@link WbsMappingError} if the merged mapping is invalid (e.g. no scope
 * supplied a required `id`/`name`). A layer that is absent contributes nothing.
 */
export function mergeWbsMapping(layers: WbsMappingLayers): WbsFieldMapping {
  const merged: Record<string, unknown> = {};
  for (const key of LAYER_ORDER) {
    const layer = layers[key];
    if (!layer || typeof layer !== "object") continue;
    for (const [k, v] of Object.entries(layer)) {
      if (v !== undefined) merged[k] = v; // a layer clears nothing; it only sets fields it names
    }
  }
  return sanitizeWbsMapping(merged);
}

// ── Storage ──────────────────────────────────────────────────────────────────────────────────────────────
// One sealed map per scope: slot → partial mapping override. Mirrors def-binding's per-scope storage, so an
// override is confined to the scope file it lives in.
export const WBS_MAPPING_ARTIFACT = "wbs-mapping";
const OVERRIDES_ID = "overrides";
interface StoredWbsMappings { id: string; slots: Record<string, Partial<WbsFieldMapping>> }

/** The slot→override map stored at one scope (empty when unset / store off). */
export function getScopeWbsMappings(scope: ArtifactScope): Record<string, Partial<WbsFieldMapping>> {
  return getArtifact<StoredWbsMappings>(WBS_MAPPING_ARTIFACT, scope, OVERRIDES_ID)?.slots ?? {};
}

/**
 * Set (or clear, with `mapping: null`) one slot's override at a scope; returns the new map. A non-null override
 * is validated through {@link sanitizeWbsMapping} FIRST (the choke point), so a stored override can never be a
 * shape the read path would reject.
 */
export function setScopeWbsMapping(scope: ArtifactScope, slot: string, mapping: WbsFieldMapping | null): Record<string, Partial<WbsFieldMapping>> {
  const next = { ...getScopeWbsMappings(scope) };
  if (mapping === null) delete next[slot];
  else next[slot] = sanitizeWbsMapping(mapping);
  putArtifact<StoredWbsMappings>(WBS_MAPPING_ARTIFACT, scope, { id: OVERRIDES_ID, slots: next });
  return next;
}

/** The caller's resolution context — which programme/project/user layers to consult. */
export interface WbsMappingCtx { projectId?: string; programmeId?: string; sub?: string }

/**
 * Resolve the effective WBS mapping for a caller + slot: the shipped core beneath, then org → (their) programme
 * → (their) project → (their) user overrides from the sealed store, merged per-field nearest-wins. Only the
 * caller's own programme/project/user scopes are consulted, so one caller can never see another's override.
 * Throws {@link WbsMappingError} if the slot has no core mapping and no scope supplies a valid whole mapping.
 */
export function resolveWbsMapping(ctx: WbsMappingCtx, slot: string = DEFAULT_WBS_SLOT): WbsFieldMapping {
  const layers: WbsMappingLayers = {};
  const core = CORE_WBS_MAPPINGS[slot];
  if (core) layers.core = core;
  const org = getScopeWbsMappings({ kind: "org" })[slot];
  if (org) layers.org = org;
  if (ctx.programmeId) {
    const p = getScopeWbsMappings({ kind: "programme", programmeId: ctx.programmeId })[slot];
    if (p) layers.programme = p;
  }
  if (ctx.projectId) {
    const p = getScopeWbsMappings({ kind: "project", projectId: ctx.projectId })[slot];
    if (p) layers.project = p;
  }
  if (ctx.sub) {
    const u = getScopeWbsMappings({ kind: "user", sub: ctx.sub })[slot];
    if (u) layers.user = u;
  }
  if (!layers.core && !layers.org && !layers.programme && !layers.project && !layers.user) {
    throw new WbsMappingError(`no WBS mapping for slot "${slot}"`);
  }
  return mergeWbsMapping(layers);
}
