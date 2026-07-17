import { mergeMappings, type Mapping } from "./mapping";
import { storedMappingLayers, type MappingCtx } from "./mapping-resolve";
import { WbsMappingError, type WbsFieldMapping } from "./wbs-mapping";
import { BUILTIN_BROKER, SIDECAR_BACKEND, type FieldRef } from "./field-target";

/**
 * WBS mapping resolution (roadmap §4.6) — the WBS cost screen's view over the first-class {@link Mapping}
 * object. The mapping is now authored + stored like any other def (`kind: "mapping"`, slot `"wbs"`), resolved
 * like screens/reports/def-bindings: a shipped CORE mapping beneath, then the org's legacy `fieldRouting`
 * (subsumed via `mappingFromFieldRoutes`), then org → programme → project → user mapping defs — merged PER
 * FIELD, nearest wins. The merged generic Mapping is then adapted to the {@link WbsFieldMapping} the WBS
 * projector (`applyWbsMapping`) consumes.
 *
 * This is the "already established pattern": core mappings ship in the system store; users/PMs/programme
 * managers/orgs override through the ONE importer at whatever scope they own, each override confined to its own
 * sealed scope file. PURE resolution over the def store — no bespoke storage of its own.
 */

/** The default mapping slot when a screen/route doesn't name one. */
export const DEFAULT_WBS_SLOT = "wbs";

/**
 * The shipped CORE WBS mapping (the system layer) — a generic {@link Mapping} we bundle, overridable by every
 * scope above. With no home declared it resolves to the built-in broker + sidecar backend, so out of the box
 * the cost screen renders from our all-in-one store with no configuration; a customer on SAP/OpenProject/Jira
 * overrides the fields (and their broker/backend) at whatever scope they choose.
 */
export const CORE_WBS_MAPPING: Mapping = {
  id: DEFAULT_WBS_SLOT,
  // The all-in-one home, DECLARED (not silently assumed): out of the box the WBS lives in our built-in broker +
  // sidecar. An admin overrides the home (or individual fields) to point at SAP/OpenProject/… at any scope.
  broker: BUILTIN_BROKER, backend: SIDECAR_BACKEND,
  fields: {
    id: "id", name: "name", parentId: "parentId", status: "status", responsible: "responsible",
    budget: "budget", actual: "actual", commitment: "commitment", wip: "wip", planned: "planned",
    currency: "currency",
  },
  defaults: { currency: "GBP" },
};

/** Extract the native field NAME from a ref for a home-only structure field (broker/backend ignored — structure
 *  always reads from the home). */
const fieldNameOf = (ref: FieldRef | undefined): string | undefined =>
  ref === undefined ? undefined : typeof ref === "string" ? ref : ref.field;

/**
 * Adapt a resolved generic {@link Mapping} to the {@link WbsFieldMapping} the WBS projector consumes: structure
 * keys (id/name/parent/status/responsible) become home field names; financial keys stay {@link FieldRef}s (so
 * each keeps its own broker/backend); `defaults.currency` becomes `currencyDefault`. Throws {@link
 * WbsMappingError} if the merged mapping lacks the required id/name.
 */
export function mappingToWbs(m: Mapping): WbsFieldMapping {
  const id = fieldNameOf(m.fields["id"]);
  const name = fieldNameOf(m.fields["name"]);
  if (!id || !name) throw new WbsMappingError("resolved WBS mapping needs id + name fields");
  const out: WbsFieldMapping = { id, name };
  if (m.broker !== undefined) out.broker = m.broker;
  if (m.backend !== undefined) out.backend = m.backend;
  if (m.joinField !== undefined) out.joinField = m.joinField;
  for (const k of ["parentId", "status", "responsible"] as const) {
    const v = fieldNameOf(m.fields[k]);
    if (v !== undefined) out[k] = v;
  }
  for (const k of ["budget", "actual", "commitment", "wip", "planned", "currency"] as const) {
    const ref = m.fields[k];
    if (ref !== undefined) out[k] = ref;
  }
  const currency = m.defaults?.["currency"];
  if (currency) out.currencyDefault = currency;
  return out;
}

/** The caller's resolution context — which programme/project/user layers to consult. */
export type WbsMappingCtx = MappingCtx;

/**
 * Resolve the effective WBS mapping for a caller + slot. Layers, base → nearest:
 *   core (shipped) < system-store mapping defs < org legacy `fieldRouting` (subsumed) <
 *   org < programme < project < user mapping defs
 * merged per-field (via the shared {@link storedMappingLayers}), then adapted to a {@link WbsFieldMapping}. Only
 * the caller's own programme/project/user scopes are consulted. Throws {@link WbsMappingError} if nothing
 * supplies a valid id/name.
 */
export function resolveWbsMapping(ctx: WbsMappingCtx, slot: string = DEFAULT_WBS_SLOT): WbsFieldMapping {
  const layers: Mapping[] = [];
  if (slot === DEFAULT_WBS_SLOT) layers.push(CORE_WBS_MAPPING);
  layers.push(...storedMappingLayers(ctx, slot));
  return mappingToWbs(mergeMappings(layers));
}
