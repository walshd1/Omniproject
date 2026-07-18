/**
 * SCOPED CONFIG RESOLUTION — the reusable vehicle for the model migration (roadmap §"Model migration").
 *
 * A `config` def carries a logical `id` (the config it layers, e.g. "scheduling") and a `values` object — the
 * PARTIAL contribution one scope makes to that config. The same logical id can be authored at any scope
 * (system < org < programme < project < user); `resolveScopedConfig` folds every layer that supplies it,
 * base → leaf (nearest scope wins), using the SAME deep-merge algebra as `extends` composition (`mergeValue`:
 * objects deep-merge, id/key'd arrays merge by key, scalars & keyless arrays replace whole). So a settings blob
 * becomes a composable, scope-layered def riding the importer choke point + sealed store like everything else —
 * no bespoke per-config override machinery.
 *
 * This is the SCOPE-OVERRIDE axis (nearest-wins across scopes, like mappings), distinct from the COMPOSITION
 * axis (`extends` within one kind). Both use `mergeValue`; here the layers are scopes, there they are ancestors.
 *
 * Slice 1 introduces the resolver + the `scheduling` config with the org's existing `settings.scheduling` kept
 * as a compatibility layer (NOT yet drained — reversible). Later slices move each config's authoritative source
 * from settings into config defs and retire the compat layer.
 */
import { mergeValue } from "@workspace/backend-catalogue";
import { listDefs, listSystemDefs, type StoredDef } from "./def-import";
import { getSettings, DEFAULT_SCHEDULING, type SchedulingConfig } from "./settings";

/** Which programme/project/user scopes to consult when resolving a config (org + system are always included). */
export interface ConfigScopes { projectId?: string; programmeId?: string; sub?: string }

/**
 * Fold `base` and every `layer` (a partial `values` object), base → leaf, via the shared merge algebra. Later
 * layers win property-by-property. Pure. `undefined`/non-object layers are skipped, so a missing scope is a
 * no-op rather than clobbering lower scopes.
 */
export function resolveScopedConfig<T>(base: T, layers: ReadonlyArray<unknown>): T {
  let acc: unknown = base;
  for (const layer of layers) {
    if (layer && typeof layer === "object" && !Array.isArray(layer)) acc = mergeValue(acc, layer);
  }
  return acc as T;
}

/** The `values` object of a config def, or null when it isn't a config def for `configId` / has no values. */
function configValuesOf(d: StoredDef, configId: string): Record<string, unknown> | null {
  if (d.kind !== "config") return null;
  const p = (d.payload ?? {}) as Record<string, unknown>;
  if (p["id"] !== configId) return null;
  const v = p["values"];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** The `values` layers supplied for `configId` at ONE scope, base → leaf order (a scope may hold several config
 *  defs with the same logical id; each contributes, later-listed winning — but normally there is at most one). */
function scopeLayers(rows: StoredDef[], configId: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const d of rows) { const v = configValuesOf(d, configId); if (v) out.push(v); }
  return out;
}

/**
 * Every config-def `values` layer supplying `configId`, in scope-precedence order (system → org → programme →
 * project → user). Reads the sealed def stores for each scope the caller can see. The generic scope-override
 * layer stack shared by all config resolutions.
 */
export function configDefLayers(configId: string, scopes: ConfigScopes): Record<string, unknown>[] {
  const layers: Record<string, unknown>[] = [];
  layers.push(...scopeLayers(listSystemDefs(), configId));
  layers.push(...scopeLayers(listDefs({ kind: "org" }), configId));
  if (scopes.programmeId) layers.push(...scopeLayers(listDefs({ kind: "programme", programmeId: scopes.programmeId }), configId));
  if (scopes.projectId) layers.push(...scopeLayers(listDefs({ kind: "project", projectId: scopes.projectId }), configId));
  if (scopes.sub) layers.push(...scopeLayers(listDefs({ kind: "user", sub: scopes.sub }), configId));
  return layers;
}

/**
 * Resolve a logical config to its effective value at the given scopes: `base` (the code default) with every
 * config-def layer folded on top, nearest scope winning. The generic entry point for any migrated config.
 */
export function resolveConfig<T>(configId: string, base: T, scopes: ConfigScopes): T {
  return resolveScopedConfig(base, configDefLayers(configId, scopes));
}

/**
 * The effective working-time policy at a scope. Layer order (base → leaf): the code default, then the org's
 * existing `settings.scheduling` (the COMPAT layer — scheduling's authoritative source until a later slice
 * drains it), then any `scheduling` config defs at system/org/programme/project/user. So a project-scoped
 * scheduling config def overrides the org calendar, which overrides the code default — exactly the migration's
 * scope-layered model, with no behaviour change for a deployment that authors no config defs.
 */
export function resolveScheduling(scopes: ConfigScopes = {}): SchedulingConfig {
  const orgCompat = getSettings().scheduling;
  return resolveScopedConfig<SchedulingConfig>(DEFAULT_SCHEDULING, [orgCompat, ...configDefLayers("scheduling", scopes)]);
}
