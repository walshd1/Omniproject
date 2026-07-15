import type { ScreenDef } from "./screen";
import budgetPlans from "../screens/budget-plans.json";
import resourceAllocations from "../screens/resource-allocations.json";

/**
 * Screen-definition catalogue — the panel-bearing ScreenDefs the generic builder renders, authored as
 * pure JSON under src/screens/*.json (NOT React). A "screen" is data: which panels, their kinds, spans,
 * per-panel data `source` and methodology tags. The one generic ScreenPage loads a def by id and renders
 * it through the ScreenRenderer canvas, so adding or changing an editable screen is a JSON edit, never new
 * page code — the same pipeline for budgets, reports, resources and everything else.
 *
 * Each JSON also carries an optional `hint` (a one-line subheading) that isn't part of the ScreenDef render
 * model; the builder reads it off the raw entry.
 */
export interface ScreenCatalogueEntry extends ScreenDef {
  /** Optional one-line subheading shown under the screen title. */
  hint?: string;
}

// Vite parses imported JSON to an object; the shape is validated by screen-catalogue.test.ts, so the cast
// is the single trusted boundary between "untyped JSON" and the ScreenDef model the renderer relies on.
const ENTRIES: ScreenCatalogueEntry[] = [
  budgetPlans as ScreenCatalogueEntry,
  resourceAllocations as ScreenCatalogueEntry,
];

const byId = new Map(ENTRIES.map((s) => [s.id, s]));

/** One screen definition by id, or undefined when no such screen is catalogued. */
export function getScreenDef(id: string): ScreenCatalogueEntry | undefined {
  return byId.get(id);
}

/** Every catalogued screen definition (a defensive copy of the list). */
export function screenDefs(): ScreenCatalogueEntry[] {
  return [...ENTRIES];
}
