import { REPORTS, VIEWS, SCREENS, OUTPUTS, referenceRulesetCatalogue, METHODOLOGIES } from "@workspace/backend-catalogue";
import { BUILTIN_ARTIFACTS } from "../definitions";
import type { CompositionItem } from "./methodology-composition";

/**
 * Build the full list of composable items from every catalogue the composer exposes — reports, views,
 * screens and outputs (the artifacts + outputs), the reference rulesets (business rules), and the shipped
 * drop-in artifact defs. Each carries the methodology tags it already declares, so the composition engine
 * can derive one preset per methodology and a PMO can mix them. Pure — reads only the static catalogues.
 */
export function buildCompositionItems(): CompositionItem[] {
  const items: CompositionItem[] = [];
  for (const r of REPORTS) items.push({ id: `report:${r.id}`, kind: "report", label: r.label, methodologies: r.methodologies ?? [] });
  for (const v of VIEWS) items.push({ id: `view:${v.id}`, kind: "view", label: v.label, methodologies: v.methodologies });
  for (const s of SCREENS) items.push({ id: `screen:${s.id}`, kind: "screen", label: s.label, methodologies: s.methodologies ?? [] });
  for (const o of OUTPUTS) items.push({ id: `output:${o.id}`, kind: "output", label: o.label, methodologies: (o as { methodologies?: string[] }).methodologies ?? [] });
  for (const rs of referenceRulesetCatalogue()) items.push({ id: `ruleset:${rs.id}`, kind: "ruleset", label: rs.label, methodologies: [rs.id] });
  for (const a of BUILTIN_ARTIFACTS) items.push({ id: `artifact:${a.id}`, kind: a.kind === "report" ? "report" : "view", label: a.label, methodologies: a.methodologies ?? [] });
  return items;
}

/** The display label for a methodology id (its catalogue label), or undefined. */
export function methodologyLabel(id: string): string | undefined {
  return METHODOLOGIES.find((m) => m.id === id)?.label;
}
