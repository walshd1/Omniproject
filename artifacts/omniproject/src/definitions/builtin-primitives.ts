import type { PrimitiveDef, PrimitiveCategory, PrimitiveParam, PrimitiveParamType } from "../components/charts/catalogue";

/**
 * Baseline / drop-in primitive definitions. The code catalogue is the shipped baseline; a methodology
 * pack (or a later update) can add or refresh primitives by dropping `.json` files into
 * `builtin/primitives/` — same enumerable, stateless, read-only pattern as the artifact defs. A drop-in
 * with a `chartType` binds to the common ChartView renderer; one without is library metadata for a
 * primitive drawn by a registered component. Merged over the code baseline by id, so a pack can refresh a
 * shipped primitive's metadata or introduce a new one without a code change.
 */
const CATEGORIES = new Set<PrimitiveCategory>(["chart", "graphic", "table", "tile"]);

// The ChartView spec types a `chartType` may bind to. Kept in step with ChartView by the catalogue
// coverage test; a drop-in naming anything else is rejected rather than silently un-renderable.
const CHART_TYPES = new Set(["bar", "line", "area", "pie", "donut", "scatter", "treemap", "gantt"]);

const PARAM_TYPES = new Set<PrimitiveParamType>([
  "rows", "series", "slices", "points", "tree", "items", "nodes", "geo", "columns", "string", "number", "boolean", "palette", "enum",
]);

function isParam(value: unknown): value is PrimitiveParam {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return typeof p["key"] === "string" && !!p["key"]
    && typeof p["label"] === "string"
    && PARAM_TYPES.has(p["type"] as PrimitiveParamType)
    && typeof p["required"] === "boolean"
    && typeof p["description"] === "string";
}

function isPrimitiveDef(value: unknown): value is PrimitiveDef {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  if (typeof p["id"] !== "string" || !p["id"]) return false;
  if (typeof p["label"] !== "string" || !p["label"]) return false;
  if (!CATEGORIES.has(p["category"] as PrimitiveCategory)) return false;
  if (typeof p["description"] !== "string") return false;
  if (p["chartType"] != null && !CHART_TYPES.has(p["chartType"] as string)) return false;
  if (!Array.isArray(p["params"]) || !p["params"].every(isParam)) return false;
  return true;
}

/** Validate + de-duplicate drop-in primitive JSON. Invalid or duplicate entries are skipped (first wins). */
export function parseBuiltinPrimitives(modules: Record<string, unknown>): PrimitiveDef[] {
  const byId = new Map<string, PrimitiveDef>();
  for (const raw of Object.values(modules)) {
    if (!isPrimitiveDef(raw)) continue;
    if (!byId.has(raw.id)) byId.set(raw.id, raw);
  }
  return [...byId.values()];
}

/** Merge drop-in primitives over the code baseline by id — a drop-in refreshes a baseline entry or adds a
 *  new one; baseline order is preserved, new drop-ins append in id order. */
export function mergePrimitives(base: readonly PrimitiveDef[], dropIns: readonly PrimitiveDef[]): PrimitiveDef[] {
  const overrides = new Map(dropIns.map((d) => [d.id, d]));
  const merged = base.map((b) => overrides.get(b.id) ?? b);
  const seen = new Set(base.map((b) => b.id));
  const added = dropIns.filter((d) => !seen.has(d.id)).sort((a, b) => a.id.localeCompare(b.id));
  return [...merged, ...added];
}
