import { reportCatalogue, type ReportDefinition } from "./report-catalogue";
import { widgetCatalogue, type WidgetDefinition } from "./widget-catalogue";

/**
 * The unified COMPONENT LIBRARY — one registry over the report + widget catalogues, so a customer can
 * browse every reusable building block and place it into their own content. Reports and dashboard widgets
 * are functionally the same thing (a definition bound to a registered renderer over the read model); this
 * projects both into a single `LibraryComponent` list tagged with WHERE each can be placed (`placeableIn`).
 *
 * The renderer is resolved by the SPA (see resolveLibraryComponent), which bridges the report-renderer
 * registry and the dashboard WIDGET_COMPONENTS registry via `renderer.registry`. Nothing here is code —
 * it is data derived from the two JSON catalogues.
 */

/** The surfaces a library component can be placed into. */
export type ComponentSurface = "report" | "dashboard" | "content" | "export";

export interface ComponentRenderer {
  engine: "builtin" | "custom";
  /** The SPA renderer key: the report-renderer component name (registry "report") or the widget type
   *  (registry "widget"). Absent for a surfaced-via / custom-engine component. */
  component?: string;
  /** Which SPA registry resolves `component`. */
  registry: "report" | "widget";
  /** Present when the component is reached through another plane (e.g. a board view), not rendered inline. */
  surfacedVia?: string;
}

export interface LibraryComponent {
  /** Namespaced id, unique across sources: "report:evm" / "widget:portfolioHealth". */
  id: string;
  /** The original catalogue id (report id) or widget type. */
  sourceId: string;
  /** Which catalogue the component came from. */
  source: "report" | "widget";
  label: string;
  /** Grouping: the report kind, or "dashboard" for a widget. */
  category: string;
  description?: string;
  renderer: ComponentRenderer;
  /** Where a user may place this component. */
  placeableIn: ComponentSurface[];
  /** Backend capability the component needs (null = always available). */
  requiresCapability: string | null;
  /** Default dashboard column span (widgets only). */
  defaultSpan?: 1 | 2 | 3;
  /** Display order within its source catalogue. */
  order: number;
  /** Auto-refresh interval in seconds — declarative polling for whatever surface renders this
   *  component, instead of each renderer hardcoding its own. Sourced from the report/widget JSON
   *  definition. Omitted = no auto-refresh. */
  refresh?: number;
}

function fromReport(r: ReportDefinition): LibraryComponent {
  // Build the renderer omitting undefined keys (exactOptionalPropertyTypes).
  const renderer: ComponentRenderer = { engine: r.renderer.engine, registry: "report" };
  if (r.renderer.component) renderer.component = r.renderer.component;
  if (r.renderer.surfacedVia) renderer.surfacedVia = r.renderer.surfacedVia;
  const c: LibraryComponent = {
    id: `report:${r.id}`,
    sourceId: r.id,
    source: "report",
    label: r.label,
    category: r.kind,
    renderer,
    // A report renders on the Reports page, can be embedded in custom content, and captured into exports.
    placeableIn: ["report", "content", "export"],
    requiresCapability: r.capabilities.requiresCapability,
    order: r.order,
  };
  if (r.notes) c.description = r.notes;
  if (r.refresh) c.refresh = r.refresh;
  return c;
}

function fromWidget(w: WidgetDefinition): LibraryComponent {
  const c: LibraryComponent = {
    id: `widget:${w.type}`,
    sourceId: w.type,
    source: "widget",
    label: w.label,
    category: "dashboard",
    description: w.description,
    renderer: { engine: "builtin", component: w.type, registry: "widget" },
    // A widget lives on a dashboard, can be embedded in custom content, and captured into exports.
    placeableIn: ["dashboard", "content", "export"],
    requiresCapability: w.requiresEntity ?? null,
    defaultSpan: w.defaultSpan,
    order: w.order ?? 0,
  };
  if (w.refresh) c.refresh = w.refresh;
  return c;
}

/** The whole library — every report + widget as one list. Derived from the JSON catalogues, which
 *  are themselves static, so this is built ONCE at module load instead of re-derived on every call
 *  (every dashboard/report render used to pay this). See docs/PERF-PATTERNS-REVIEW.md, Theme B. */
const LIBRARY: LibraryComponent[] = [...reportCatalogue().map(fromReport), ...widgetCatalogue().map(fromWidget)];

/** id → component, built once alongside LIBRARY — O(1) lookups instead of a linear `.find`. */
const BY_ID: Map<string, LibraryComponent> = new Map(LIBRARY.map((c) => [c.id, c]));

/** The whole library — every report + widget as one list. Derived from the JSON catalogues. */
export function componentLibrary(): LibraryComponent[] {
  return LIBRARY;
}

/** The components a user may place into a given surface, in display order. */
export function componentsFor(surface: ComponentSurface): LibraryComponent[] {
  return LIBRARY.filter((c) => c.placeableIn.includes(surface)).sort((a, b) => a.order - b.order);
}

/** One library component by its namespaced id, or undefined. */
export function getComponent(id: string): LibraryComponent | undefined {
  return BY_ID.get(id);
}
