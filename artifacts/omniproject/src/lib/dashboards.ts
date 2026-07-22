import { configResource } from "./config-resource";
import {
  WIDGETS,
  widgetDef,
  availableWidgets,
  availablePresets,
  presetForRole,
  type WidgetDefinition,
  type DashboardPreset,
} from "@workspace/backend-catalogue";

/**
 * Custom-dashboards client. A dashboard is a named, ordered list of widget instances chosen from
 * the widget catalogue (WIDGET_CATALOGUE). Dashboards are SHARED, customer-level presentation config
 * persisted to the config bundle via /api/dashboards — any authenticated user can build/switch, like
 * a team's shared views. Benign presentation config, never project data.
 *
 * The widget catalogue is now DATA: authored as JSON under lib/backend-catalogue/assets/widgets/ and
 * embedded by gen-widgets (drift-guarded), the same principle as reports/views. Each widget `type` binds
 * to the SPA renderer registry (components/dashboard/widgets), enforced by the widget-coverage guard.
 */

/** A placed widget on a dashboard. `type` keys into WIDGET_CATALOGUE; `span` is the column width. */
export interface DashboardWidget {
  id: string;
  type: string;
  span?: 1 | 2 | 3;
  title?: string;
}

export interface Dashboard {
  id: string;
  name: string;
  widgets: DashboardWidget[];
  /** Auto-refresh interval (ms). When set, the dashboard re-reads its data on this cadence — a
   *  dashboard is a report that refreshes in real time. A client-side poll; no new write surface. */
  refreshMs?: number;
}

/** A widget the user can add to a dashboard (re-exported from the catalogue; the component map lives in
 *  the SPA widget renderer registry, so this stays import-light and unit-testable). */
export type WidgetDef = WidgetDefinition;

/** The catalogue of widgets a dashboard can be built from — authored as JSON in the backend catalogue. */
export const WIDGET_CATALOGUE: readonly WidgetDef[] = WIDGETS;

export { widgetDef, availableWidgets, availablePresets, presetForRole };
export type { DashboardPreset };

/**
 * Materialise a role-tailored preset into a fresh dashboard: a busy PM's "what needs me today"
 * screen, ready to persist via the existing save path (no new write surface). Each placed widget gets
 * a fresh id and inherits the preset's span (falling back to the widget's defaultSpan). The dashboard
 * id is left empty for the caller to mint (mirrors the import flow).
 */
export function dashboardFromPreset(preset: DashboardPreset): Dashboard {
  return {
    id: "",
    name: preset.name,
    widgets: preset.widgets.map((w) => {
      const widget: DashboardWidget = { id: crypto.randomUUID(), type: w.type, span: w.span ?? widgetDef(w.type)?.defaultSpan ?? 1 };
      if (w.title) widget.title = w.title;
      return widget;
    }),
  };
}

/** Clamp/normalise a span to the 1–3 grid. */
export function clampSpan(span: number | undefined): 1 | 2 | 3 {
  if (span === 2) return 2;
  if (span && span >= 3) return 3;
  return 1;
}

export const dashboardsQueryKey = ["dashboards"] as const;

const resource = configResource<Dashboard[]>({
  queryKey: dashboardsQueryKey,
  path: "/api/dashboards",
  envelopeKey: "dashboards",
  saveErrorMessage: "Failed to save dashboards",
});
export const useDashboards = resource.useResource;
/** Persist the full dashboards list (CSRF attached by the global fetch patch). */
export const useSaveDashboards = resource.useSaveResource;
