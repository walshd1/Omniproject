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
 * `scheduling` is the first migrated config: its authoritative source is the config-def store (an org-scope
 * `scheduling` config def, authored via the admin route), scope-layered over the code default. There is NO
 * settings-blob compatibility layer — the working-time policy lives entirely in the composition model.
 */
import { mergeValue } from "@workspace/backend-catalogue";
import { listDefs, listSystemDefs, getDef, putDef, type StoredDef } from "./def-import";

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

// ── Config-def-backed "collection" (the settings-collection migration vehicle) ───────────────────────────────
// A settings-collection field (an array/object like `hiddenFields`, `savedViews`, `raci`, …) becomes a config
// def whose `values` wraps the collection under a single `value` key (so an array collection still fits the
// object-only `values` shape, and scope layers still deep-merge / merge-by-id through `mergeValue`). One helper
// pair reads it (scope-folded) and writes it at org scope — the seam `settingsCollectionRouter`'s config mode
// uses, so every collection route can migrate off settings without changing its HTTP contract.

/** The scope-folded value of a config-def-backed collection, or `fallback` when unset. */
export function readConfigCollection<T>(configId: string, fallback: T, scopes: ConfigScopes = {}): T {
  const merged = resolveScopedConfig<{ value?: T }>({}, configDefLayers(configId, scopes));
  return (merged.value ?? fallback) as T;
}

/** Persist a collection as the ORG-scope config def `{ id, values: { value } }`. Singleton org row, updated in
 *  place. Store must be enabled (a no-op otherwise, matching the artifact-store's write behaviour). */
export function writeOrgConfigCollection(configId: string, name: string, value: unknown): void {
  const payload = { id: configId, values: { value } };
  const existing = getDef({ kind: "org" }, orgConfigCollectionId(configId));
  const now = new Date().toISOString();
  putDef({ kind: "org" }, existing
    ? { ...existing, payload, updatedAt: now, rowVersion: (existing.rowVersion ?? 1) + 1 }
    : { id: orgConfigCollectionId(configId), kind: "config", name, payload, createdBy: null, createdAt: now, updatedAt: now, rowVersion: 1 });
}

/** The stable storage id of an org-scope config-collection def (one singleton row per logical config). */
export function orgConfigCollectionId(configId: string): string {
  return `org~config-${configId}`;
}

/** The methodology COMPOSITION — the PMO/admin's curated set of visible artifact/output/ruleset ids, or `null`
 *  when uncurated (everything on). A config-def-backed collection whose value is nullable (so `null` — the
 *  meaningful "uncurated" — survives, unlike an array collection's `[]` default). */
export const METHODOLOGY_COMPOSITION_ID = "methodology-composition";
export function resolveMethodologyComposition(scopes: ConfigScopes = {}): string[] | null {
  return readConfigCollection<string[] | null>(METHODOLOGY_COMPOSITION_ID, null, scopes);
}

// ── Scheduling: the first migrated config (working-time policy) ──────────────────────────────────────────────
// The (client-side, projected) scheduling engine's working day/week — hours/day, working weekdays, holidays.
// Config only: the schedule itself is computed live in the browser and never persisted. Its authoritative
// source is the config-def store (an org-scope `scheduling` config def), scope-layered over the code default.

export const SCHEDULING_CONFIG_ID = "scheduling";

export interface SchedulingConfig {
  /** Hours in a working day, used to convert an estimate to a duration (default 8). */
  hoursPerDay: number;
  /** Working weekdays, 0 = Sun … 6 = Sat (default Mon–Fri = [1,2,3,4,5]). */
  workingWeekdays: number[];
  /** ISO dates (YYYY-MM-DD) that are non-working holidays (default none). */
  holidays: string[];
}

export const DEFAULT_SCHEDULING: SchedulingConfig = { hoursPerDay: 8, workingWeekdays: [1, 2, 3, 4, 5], holidays: [] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate + normalise a partial scheduling `values` payload (the org admin's working-time edit) into a clean
 * partial: hours/day in (0,24], working weekdays a non-empty set of integers 0–6 (a week with no working day
 * would make the scheduler's day arithmetic non-terminating), holidays a de-duped sorted list of ISO dates.
 * Throws {@link Error} on an invalid value. Returns only the keys that were present (a partial config layer).
 */
export function sanitizeSchedulingValues(raw: unknown): Partial<SchedulingConfig> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("scheduling values must be an object");
  const { hoursPerDay, workingWeekdays, holidays } = raw as Record<string, unknown>;
  const out: Partial<SchedulingConfig> = {};
  if (hoursPerDay !== undefined) {
    if (typeof hoursPerDay !== "number" || !Number.isFinite(hoursPerDay) || hoursPerDay <= 0 || hoursPerDay > 24) {
      throw new Error("scheduling.hoursPerDay must be a number in (0, 24]");
    }
    out.hoursPerDay = hoursPerDay;
  }
  if (workingWeekdays !== undefined) {
    if (!Array.isArray(workingWeekdays) || workingWeekdays.length === 0) throw new Error("scheduling.workingWeekdays must be a non-empty array");
    for (const d of workingWeekdays) {
      if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > 6) throw new Error("scheduling.workingWeekdays entries must be integers 0–6");
    }
    out.workingWeekdays = [...new Set(workingWeekdays as number[])].sort((a, b) => a - b);
  }
  if (holidays !== undefined) {
    if (!Array.isArray(holidays)) throw new Error("scheduling.holidays must be an array");
    for (const h of holidays) {
      if (typeof h !== "string" || !ISO_DATE.test(h)) throw new Error("scheduling.holidays entries must be YYYY-MM-DD strings");
    }
    out.holidays = [...new Set(holidays as string[])].sort();
  }
  return out;
}

/**
 * The effective working-time policy at a scope: the code default with every `scheduling` config-def layer
 * folded on top (system < org < programme < project < user), nearest scope winning. No settings compat layer —
 * a deployment that authors no scheduling config def simply gets the code default.
 */
export function resolveScheduling(scopes: ConfigScopes = {}): SchedulingConfig {
  return resolveConfig(SCHEDULING_CONFIG_ID, DEFAULT_SCHEDULING, scopes);
}
