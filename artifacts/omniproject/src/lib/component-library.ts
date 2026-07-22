import type { ComponentType } from "react";
import type { LibraryComponent } from "@workspace/backend-catalogue";
import { REPORT_RENDERERS } from "../components/reports/report-renderers";
import { WIDGET_COMPONENTS } from "../components/dashboard/widgets";

/**
 * The SPA bridge for the unified component library: resolve a `LibraryComponent` to its real React
 * renderer. This is the one place the two renderer registries (report-renderers + dashboard
 * WIDGET_COMPONENTS) are unified behind a single lookup, so any surface — reports, dashboards, custom
 * content — can render a library component by id without knowing which catalogue it came from.
 *
 * Heterogeneous props (report renderers may take `projectId`; widgets take none), so the return type is
 * intentionally loose — the caller supplies the right props for the surface.
 */
export type LibraryRenderer = ComponentType<any>;

/**
 * Resolve a library component to its renderer, or null when it has no inline renderer: a surfaced-via
 * report (reached through another plane) or a definition whose component isn't registered.
 */
export function resolveLibraryComponent(c: Pick<LibraryComponent, "renderer">): LibraryRenderer | null {
  const r = c.renderer;
  if (r.surfacedVia || !r.component) return null;
  const registry = r.registry === "widget" ? WIDGET_COMPONENTS : REPORT_RENDERERS;
  return (registry as Record<string, LibraryRenderer>)[r.component] ?? null;
}
