import type { ScreenDef, ScreenLayout } from "./screen";
import budgetPlans from "../screens/budget-plans.json";
import resourceAllocations from "../screens/resource-allocations.json";
import home from "../screens/home.json";
import myWork from "../screens/my-work.json";
import tasks from "../screens/tasks.json";
import reports from "../screens/reports.json";
import programmes from "../screens/programmes.json";
import programmeDetail from "../screens/programme-detail.json";
import projects from "../screens/projects.json";
import projectDetail from "../screens/project-detail.json";
import explore from "../screens/explore.json";

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
  /** Full-bleed: a single hosted full-page component that owns its own layout — rendered without the
   *  ScreenPage header chrome and the tiled grid, so a migrated page looks exactly as it did. */
  bare?: boolean;
  /**
   * A methodology's CANONICAL arrangement of this screen (panel order / spans / hidden), keyed by
   * methodology id. This is the layout half of "a methodology defines canonical screen content and
   * layouts": the panels' `methodologies` tags already decide the canonical CONTENT (via
   * panelsForMethodology); this decides how those panels are laid out for that methodology. It sits
   * BENEATH the customer's own saved layout — a PMO's drag-customisation always wins — so it's the
   * sensible default arrangement a methodology ships, authored entirely in the screen's JSON.
   */
  methodologyLayouts?: Record<string, ScreenLayout>;
}

// Vite parses imported JSON to an object; the shape is validated by screen-catalogue.test.ts, so the cast
// is the single trusted boundary between "untyped JSON" and the ScreenDef model the renderer relies on.
const ENTRIES: ScreenCatalogueEntry[] = [
  budgetPlans as ScreenCatalogueEntry,
  resourceAllocations as ScreenCatalogueEntry,
  home as ScreenCatalogueEntry,
  myWork as ScreenCatalogueEntry,
  tasks as ScreenCatalogueEntry,
  reports as ScreenCatalogueEntry,
  programmes as ScreenCatalogueEntry,
  programmeDetail as ScreenCatalogueEntry,
  projects as ScreenCatalogueEntry,
  projectDetail as ScreenCatalogueEntry,
  explore as ScreenCatalogueEntry,
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

/**
 * The methodology's canonical layout for a screen, or null. Pure — returns the arrangement authored in the
 * screen's JSON for `methodology`, used as the fallback BENEATH a customer's own saved layout. Null when
 * no methodology is active or the screen ships no canonical layout for it.
 */
export function canonicalLayoutFor(entry: ScreenCatalogueEntry, methodology?: string): ScreenLayout | null {
  if (!methodology) return null;
  return entry.methodologyLayouts?.[methodology] ?? null;
}
