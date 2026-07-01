import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, safeJson, responseError } from "./api";
import { WIDGETS, widgetDef, availableWidgets, type WidgetDefinition } from "@workspace/backend-catalogue";

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
}

/** A widget the user can add to a dashboard (re-exported from the catalogue; the component map lives in
 *  the SPA widget renderer registry, so this stays import-light and unit-testable). */
export type WidgetDef = WidgetDefinition;

/** The catalogue of widgets a dashboard can be built from — authored as JSON in the backend catalogue. */
export const WIDGET_CATALOGUE: readonly WidgetDef[] = WIDGETS;

export { widgetDef, availableWidgets };

/** Clamp/normalise a span to the 1–3 grid. */
export function clampSpan(span: number | undefined): 1 | 2 | 3 {
  if (span === 2) return 2;
  if (span && span >= 3) return 3;
  return 1;
}

export const dashboardsQueryKey = ["dashboards"] as const;

export function useDashboards() {
  return useQuery({
    queryKey: dashboardsQueryKey,
    queryFn: () => getJson<{ dashboards: Dashboard[] }>("/api/dashboards").then((r) => r.dashboards),
    staleTime: 30_000,
  });
}

/** Persist the full dashboards list (CSRF attached by the global fetch patch). */
export function useSaveDashboards() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dashboards: Dashboard[]) => {
      const res = await fetch("/api/dashboards", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dashboards }),
      });
      if (!res.ok) throw responseError(res, await safeJson(res), "Failed to save dashboards");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dashboardsQueryKey });
    },
  });
}
