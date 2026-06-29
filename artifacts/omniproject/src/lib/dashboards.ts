import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, safeJson, responseError } from "./api";

/**
 * Custom-dashboards client. A dashboard is a named, ordered list of widget instances chosen from
 * the widget catalogue (WIDGET_CATALOGUE). Dashboards are SHARED, customer-level presentation config
 * persisted to the config bundle via /api/dashboards — any authenticated user can build/switch, like
 * a team's shared views. Benign presentation config, never project data.
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

/** A widget the user can add to a dashboard. Pure metadata — the component map lives in the SPA
 *  widget registry (components/dashboard/widgets) so this stays import-light and unit-testable. */
export interface WidgetDef {
  type: string;
  label: string;
  description: string;
  /** Default column span when first added (1–3). */
  defaultSpan: 1 | 2 | 3;
  /** If set, the widget is only offered when the backend can surface that entity. */
  requiresEntity?: string;
}

/** The catalogue of widgets a dashboard can be built from. All read through the existing read-model
 *  (portfolio, projects, programmes, activity) — no new write surface. */
export const WIDGET_CATALOGUE: readonly WidgetDef[] = [
  { type: "portfolioHealth", label: "Portfolio health", description: "RAG health cards across the portfolio.", defaultSpan: 3 },
  { type: "portfolioTrends", label: "Portfolio trends", description: "Aggregate progress and budget trend over time.", defaultSpan: 2 },
  { type: "recentActivity", label: "Recent activity", description: "The latest activity across projects.", defaultSpan: 1 },
  { type: "projectCount", label: "Project count", description: "Total number of projects.", defaultSpan: 1 },
  { type: "programmeCount", label: "Programme count", description: "Total number of programmes.", defaultSpan: 1, requiresEntity: "programme" },
  { type: "statusBreakdown", label: "Status breakdown", description: "Projects grouped by status.", defaultSpan: 1 },
] as const;

/** Look up a widget definition by type (undefined for an unknown/removed type). */
export function widgetDef(type: string): WidgetDef | undefined {
  return WIDGET_CATALOGUE.find((w) => w.type === type);
}

/** The widgets offered for the active backend — drops entity-gated widgets the backend can't
 *  surface. `canSurface` mirrors capabilities-fields.canSurfaceEntity (permissive by default). */
export function availableWidgets(canSurface: (entity: string) => boolean): WidgetDef[] {
  return WIDGET_CATALOGUE.filter((w) => !w.requiresEntity || canSurface(w.requiresEntity));
}

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
