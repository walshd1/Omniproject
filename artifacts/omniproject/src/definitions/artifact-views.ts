import { BUILTIN_ARTIFACTS } from "./index";
import type { ViewDefinition, EngineViewKind, ViewChartSpec } from "../lib/view-engine/view-defs";

/**
 * Adapt the shipped baseline *view* artifacts (kind "view" in builtin/artifacts/*.json) into the unified
 * ViewDefinition shape, so a dropped-in view def renders through the view engine exactly like a built-in
 * or a saved view — read-only. Only the fields the engine understands are carried across; an unknown
 * viewKind falls back to "list".
 */
const KINDS = new Set<EngineViewKind>(["list", "table", "board", "timeline", "chart"]);

export function builtinArtifactViewsFor(entity: string): ViewDefinition[] {
  return BUILTIN_ARTIFACTS
    .filter((a) => a.kind === "view" && (a.spec as { entity?: string }).entity === entity)
    .map((a) => {
      const s = a.spec as Record<string, unknown>;
      const kind: EngineViewKind = KINDS.has(s["viewKind"] as EngineViewKind) ? (s["viewKind"] as EngineViewKind) : "list";
      const def: ViewDefinition = { id: a.id, name: a.label, entity, kind, builtin: true };
      if (s["chart"] && typeof s["chart"] === "object") def.chart = s["chart"] as ViewChartSpec;
      if (Array.isArray(s["columns"])) def.columns = s["columns"] as string[];
      if (typeof s["dateField"] === "string") def.dateField = s["dateField"];
      return def;
    });
}
