/**
 * WIDGET registry — the dashboard widget types OmniProject can render. Same principle as reports and
 * views: a neutral manifest authored as JSON (assets/widgets/<type>.json), embedded by gen-widgets and
 * drift-guarded in CI. The widget's `type` binds it to the SPA widget renderer registry
 * (components/dashboard/widgets WIDGET_COMPONENTS) — the widget-coverage guard keeps that binding honest.
 *
 * All widgets read through the existing read-model (portfolio, projects, programmes, activity); a widget
 * is only OFFERED when the backend can surface the entity it needs (`requiresEntity`).
 */
import { WIDGETS_DATA } from "./widgets.generated";

export interface WidgetDefinition {
  /** Unique widget type; the key into the SPA widget renderer registry. */
  type: string;
  label: string;
  description: string;
  /** Default column span when first added (1–3). */
  defaultSpan: 1 | 2 | 3;
  /** If set, the widget is only offered when the backend can surface that entity. */
  requiresEntity?: string;
  /** Display order in the widget picker. */
  order?: number;
  /** Auto-refresh interval in seconds when rendered as a library component — declarative polling
   *  instead of each widget hardcoding its own. Omitted = no auto-refresh. */
  refresh?: number;
}

/** Every shipped widget, in display order. Authored as JSON under assets/widgets/<type>.json and
 *  embedded by gen-widgets (drift-guarded in CI). */
export const WIDGETS: WidgetDefinition[] = [...WIDGETS_DATA].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

/** One widget definition by type, or undefined. */
export function widgetDef(type: string): WidgetDefinition | undefined {
  return WIDGETS.find((w) => w.type === type);
}

/** All widget definitions (a defensive copy). */
export function widgetCatalogue(): WidgetDefinition[] {
  return WIDGETS.map((w) => ({ ...w }));
}

/** The widgets offered for the active backend — drops entity-gated widgets it can't surface.
 *  `canSurface` mirrors the SPA's capabilities predicate (permissive by default). */
export function availableWidgets(canSurface: (entity: string) => boolean): WidgetDefinition[] {
  return WIDGETS.filter((w) => !w.requiresEntity || canSurface(w.requiresEntity));
}
