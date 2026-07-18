import { getSettings } from "./settings";
import { listDefs, listSystemDefs, type StoredDef } from "./def-import";
import { sanitizeMapping, mergeMappings, mappingFromFieldRoutes, type Mapping } from "./mapping";
import { getMappingDef } from "@workspace/backend-catalogue";

/**
 * MAPPING RESOLUTION (roadmap §4.6) — the scope layering shared by EVERY mapped surface (WBS today; screens /
 * forms / reports "across the board"). A mapping slot resolves like screens/reports/def-bindings: the org's
 * legacy `fieldRouting` (subsumed) + the system-store mapping defs beneath, then org → programme → project →
 * user mapping defs, merged PER FIELD (nearest wins). The shipped CORE layer is sourced from the JSON mapping
 * catalogue (assets/mappings/) — the same JSON the system store is seeded from, so there is one source of truth
 * and no hand-written TS mapping constants. Consumers (e.g. WBS) adapt the merged mapping to their view.
 *
 * PURE over the def store + settings — no bespoke storage.
 */

/** The `mapping` defs at a scope whose slot matches, re-sanitised (a payload that fails validation is skipped —
 *  it passed on write, so this only guards against a corrupted store). */
function mappingDefsForSlot(rows: StoredDef[], slot: string): Mapping[] {
  const out: Mapping[] = [];
  for (const r of rows) {
    if (r.kind !== "mapping") continue;
    let m: Mapping;
    try { m = sanitizeMapping(r.payload); } catch { continue; }
    if (m.id === slot) out.push(m);
  }
  return out;
}

/** The shipped CORE mapping for a slot, sourced from the JSON catalogue (`@workspace/backend-catalogue`
 *  assets/mappings/<slot>.json), sanitised into a `Mapping`. This is the store-off fallback + base layer for
 *  every slot OmniProject ships a default for (`dependencies`, `wbs`, `sprints`, `epics`, …) — the SAME JSON the
 *  system store is seeded from, so there is ONE source of truth and no hand-written TS mapping constants. Empty
 *  when the slot has no shipped default. */
function coreMappingLayers(slot: string): Mapping[] {
  const def = getMappingDef(slot);
  if (!def) return [];
  try { return [sanitizeMapping(def)]; } catch { return []; }
}

/** The caller's resolution context — which programme/project/user layers to consult. */
export interface MappingCtx { projectId?: string; programmeId?: string; sub?: string }

/**
 * The store-sourced mapping layers for a slot, base → nearest: system-store mapping defs (shipped) → org legacy
 * `fieldRouting` (subsumed) → org → programme → project → user mapping defs. Only the caller's own
 * programme/project/user scopes are consulted. A consumer prepends any shipped CORE layer before merging.
 */
export function storedMappingLayers(ctx: MappingCtx, slot: string): Mapping[] {
  const layers: Mapping[] = [];
  layers.push(...coreMappingLayers(slot));
  layers.push(...mappingDefsForSlot(listSystemDefs(), slot));
  const routes = getSettings().fieldRouting;
  if (Array.isArray(routes) && routes.length) layers.push(mappingFromFieldRoutes(routes, slot));
  layers.push(...mappingDefsForSlot(listDefs({ kind: "org" }), slot));
  if (ctx.programmeId) layers.push(...mappingDefsForSlot(listDefs({ kind: "programme", programmeId: ctx.programmeId }), slot));
  if (ctx.projectId) layers.push(...mappingDefsForSlot(listDefs({ kind: "project", projectId: ctx.projectId }), slot));
  if (ctx.sub) layers.push(...mappingDefsForSlot(listDefs({ kind: "user", sub: ctx.sub }), slot));
  return layers;
}

/**
 * Resolve the effective GENERIC mapping for a slot — the merged store layers (no consumer-specific core).
 * Returns null when no layer supplies the slot (the caller decides whether that's a 404 or an empty surface).
 */
export function resolveMapping(ctx: MappingCtx, slot: string): Mapping | null {
  const layers = storedMappingLayers(ctx, slot);
  return layers.length ? mergeMappings(layers) : null;
}
