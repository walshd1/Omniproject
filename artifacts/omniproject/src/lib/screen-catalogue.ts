import type { ScreenDef, ScreenLayout } from "./screen";
import { isItemVisible, type Composition, type CompositionItem } from "./methodology-composition";
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
import kanban from "../screens/kanban.json";
import scrum from "../screens/scrum.json";
import sprints from "../screens/sprints.json";
import userStories from "../screens/user-stories.json";
import burndown from "../screens/burndown.json";
import gantt from "../screens/gantt.json";
import prince2 from "../screens/prince2.json";
import raid from "../screens/raid.json";
import intake from "../screens/intake.json";
// Project-scoped sub-screens (match backend screen ids → no `route`, so they don't double-register as
// composition items; their routes are wired explicitly in App with the :projectId param).
import projectGantt from "../screens/project-gantt.json";
import riskRegister from "../screens/risk-register.json";
import raciMatrix from "../screens/raci-matrix.json";
import stakeholders from "../screens/stakeholders.json";

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
  /** A CORE screen: essential to the app (Home, Projects, …). It can be CUSTOMISED (overridden) but never
   *  turned off — the OFF switch is refused for it in the admin panel and ignored by the builder. */
  core?: boolean;
  /**
   * A methodology's CANONICAL arrangement of this screen (panel order / spans / hidden), keyed by
   * methodology id. This is the layout half of "a methodology defines canonical screen content and
   * layouts": the panels' `methodologies` tags already decide the canonical CONTENT (via
   * panelsForMethodology); this decides how those panels are laid out for that methodology. It sits
   * BENEATH the customer's own saved layout — a PMO's drag-customisation always wins — so it's the
   * sensible default arrangement a methodology ships, authored entirely in the screen's JSON.
   */
  methodologyLayouts?: Record<string, ScreenLayout>;
  /** Route this screen mounts at. Present only on catalogue-OWNED screens (the artifact screens a
   *  methodology ships, e.g. a Kanban board) — the migrated core pages keep their hand-written routes.
   *  A screen with a `route` is auto-surfaced in nav + routing, gated by the methodology composition. */
  route?: string;
  /** Nav presentation for a routed catalogue screen. */
  nav?: { label?: string; group?: "primary" | "admin" };
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
  kanban as ScreenCatalogueEntry,
  scrum as ScreenCatalogueEntry,
  sprints as ScreenCatalogueEntry,
  userStories as ScreenCatalogueEntry,
  burndown as ScreenCatalogueEntry,
  gantt as ScreenCatalogueEntry,
  prince2 as ScreenCatalogueEntry,
  raid as ScreenCatalogueEntry,
  intake as ScreenCatalogueEntry,
  projectGantt as ScreenCatalogueEntry,
  riskRegister as ScreenCatalogueEntry,
  raciMatrix as ScreenCatalogueEntry,
  stakeholders as ScreenCatalogueEntry,
];

const byId = new Map(ENTRIES.map((s) => [s.id, s]));
const CORE_IDS = new Set(ENTRIES.filter((s) => s.core).map((s) => s.id));

/** Whether a screen is CORE (essential — customisable but never turn-off-able). Read from the BUILT-IN
 *  catalogue, so an org override of a core screen can't quietly drop its core protection. */
export function screenIsCore(id: string): boolean {
  return CORE_IDS.has(id);
}

/** One screen definition by id, or undefined when no such screen is catalogued. */
export function getScreenDef(id: string): ScreenCatalogueEntry | undefined {
  return byId.get(id);
}

/** Every BUILT-IN catalogued screen definition (a defensive copy). The effective catalogue a user sees is
 *  this merged with their org's stored defs — see mergeScreens / the useResolvedScreens hook. */
export function screenDefs(): ScreenCatalogueEntry[] {
  return [...ENTRIES];
}

/**
 * The EFFECTIVE screen catalogue: the built-ins with the org's stored screen defs merged over them. An org
 * def with the same id OVERRIDES the built-in (a PMO's from-scratch or modified screen wins); an org def
 * with a new id is appended (a net-new screen, e.g. from a methodology bundle). Pure — the caller supplies
 * the org defs (from the encrypted /api/screen-defs store); order is built-ins first, then org-only additions.
 */
export function mergeScreens(orgDefs: readonly ScreenCatalogueEntry[]): ScreenCatalogueEntry[] {
  const overrides = new Map(orgDefs.map((s) => [s.id, s]));
  const merged = ENTRIES.map((b) => overrides.get(b.id) ?? b);
  const builtinIds = new Set(ENTRIES.map((b) => b.id));
  for (const s of orgDefs) if (!builtinIds.has(s.id)) merged.push(s);
  return merged;
}

/** Resolve one screen def by id from the merged catalogue (org override wins). */
export function resolveScreenDef(id: string, orgDefs: readonly ScreenCatalogueEntry[]): ScreenCatalogueEntry | undefined {
  return orgDefs.find((s) => s.id === id) ?? getScreenDef(id);
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

/**
 * Catalogue-OWNED routed screens — the artifact screens a methodology ships (they declare a `route`), as
 * opposed to the migrated core pages (which keep their hand-written routes and aren't methodology-gated).
 * These are the screens that appear/disappear with the methodology composition.
 */
export function routedScreens(): ScreenCatalogueEntry[] {
  return ENTRIES.filter((s) => typeof s.route === "string" && s.route.length > 0);
}

/**
 * The routed catalogue screens as methodology-composition items (kind "screen"), so the composer lists
 * them and a methodology preset (e.g. Kanban) enables its tagged screens. Ids are `screen:<id>`, matching
 * the backend screen items — catalogue screen ids are net-new (kanban, …) so they don't collide.
 */
export function screenCompositionItems(): CompositionItem[] {
  return routedScreens().map((s) => ({ id: `screen:${s.id}`, kind: "screen", label: s.label, methodologies: s.methodologies ?? [] }));
}

/**
 * Is a routed catalogue screen visible under the active composition? A neutral (untagged / "*") screen is
 * always visible; a methodology-tagged one shows only when the composition enables it — so selecting Kanban
 * surfaces the Kanban-tagged screens and hides the others. `null` composition = uncurated = all visible.
 */
export function screenVisibleUnder(composition: Composition, entry: ScreenCatalogueEntry): boolean {
  const tags = entry.methodologies ?? [];
  if (tags.length === 0 || tags.includes("*")) return true;
  return isItemVisible(composition, "screen", entry.id);
}

/** The routed catalogue screens visible under a composition (for nav + routing). */
export function visibleRoutedScreens(composition: Composition): ScreenCatalogueEntry[] {
  return routedScreens().filter((s) => screenVisibleUnder(composition, s));
}
