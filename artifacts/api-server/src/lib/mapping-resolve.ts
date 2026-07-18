import { getSettings } from "./settings";
import { listDefs, listSystemDefs, type StoredDef } from "./def-import";
import { sanitizeMapping, mergeMappings, mappingFromFieldRoutes, type Mapping } from "./mapping";
import { BUILTIN_BROKER, SIDECAR_BACKEND } from "./field-target";

/**
 * MAPPING RESOLUTION (roadmap §4.6) — the scope layering shared by EVERY mapped surface (WBS today; screens /
 * forms / reports "across the board"). A mapping slot resolves like screens/reports/def-bindings: the org's
 * legacy `fieldRouting` (subsumed) + the system-store mapping defs beneath, then org → programme → project →
 * user mapping defs, merged PER FIELD (nearest wins). Consumers add their own shipped CORE layer on top of the
 * base (e.g. WBS prepends `CORE_WBS_MAPPING`) and adapt the merged mapping to their view.
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

/** Shipped CORE mapping defs, keyed by slot — the base layer for a slot that OmniProject ships a default for,
 *  so it resolves out of the box (org/programme/project/user layers still override per field). The dependency
 *  graph is a `dependencies` slot: `{fromId, toId, kind, note}` rows homed on the built-in broker's sidecar by
 *  default (an admin can remap any field to a backend's native link API). No engine entity — just a def. */
const SIDECAR_HOME = { broker: BUILTIN_BROKER, backend: SIDECAR_BACKEND } as const;
const CORE_MAPPINGS: Record<string, Mapping> = {
  dependencies: {
    id: "dependencies",
    joinField: "id",
    fields: {
      id: { ...SIDECAR_HOME, field: "id" },
      fromId: { ...SIDECAR_HOME, field: "fromId" },
      toId: { ...SIDECAR_HOME, field: "toId" },
      kind: { ...SIDECAR_HOME, field: "kind" },
      note: { ...SIDECAR_HOME, field: "note" },
    },
  },
};

/** The caller's resolution context — which programme/project/user layers to consult. */
export interface MappingCtx { projectId?: string; programmeId?: string; sub?: string }

/**
 * The store-sourced mapping layers for a slot, base → nearest: system-store mapping defs (shipped) → org legacy
 * `fieldRouting` (subsumed) → org → programme → project → user mapping defs. Only the caller's own
 * programme/project/user scopes are consulted. A consumer prepends any shipped CORE layer before merging.
 */
export function storedMappingLayers(ctx: MappingCtx, slot: string): Mapping[] {
  const layers: Mapping[] = [];
  if (CORE_MAPPINGS[slot]) layers.push(CORE_MAPPINGS[slot]);
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
