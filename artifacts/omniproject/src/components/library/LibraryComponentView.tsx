import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { LibraryComponent } from "@workspace/backend-catalogue";
import { resolveLibraryComponent } from "../../lib/component-library";

/**
 * Render ANY unified library component (a report or a dashboard widget) by its `LibraryComponent`
 * descriptor — the one place a "content" or "export" surface renders an arbitrary component chosen
 * from the catalogue, instead of each surface re-implementing its own renderer switch.
 *
 * Two things it does beyond a plain `resolveLibraryComponent` + JSX call:
 *  - `component.refresh` (seconds, authored in the report/widget JSON) drives a client-side poll —
 *    the SAME "invalidate active queries on an interval" idiom used by custom dashboards' `refreshMs`
 *    (see pages/Dashboards.tsx), but keyed per-component so any surface gets declarative auto-refresh
 *    without hardcoding its own polling.
 *  - a component with no inline renderer (surfaced-via, or an unregistered custom engine) gets an
 *    honest placeholder instead of silently rendering nothing.
 *
 * `projectId`, when supplied, is passed through to project-scoped report renderers (e.g. the EVM
 * chart); portfolio-scoped renderers and widgets simply ignore the extra prop.
 */
export function LibraryComponentView({ component, projectId }: { component: LibraryComponent; projectId?: string }) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!component.refresh) return;
    const t = setInterval(() => { void qc.invalidateQueries({ refetchType: "active" }); }, component.refresh * 1000);
    return () => clearInterval(t);
  }, [component.refresh, component.id, qc]);

  const Renderer = resolveLibraryComponent(component);
  if (!Renderer) {
    return (
      <div className="bg-card border-2 border-dashed border-muted-foreground/40 p-4 h-full text-sm text-muted-foreground" data-testid={`library-component-unavailable-${component.id}`}>
        “{component.label}” isn’t available inline{component.renderer.surfacedVia ? ` — surfaced via ${component.renderer.surfacedVia}` : "."}
      </div>
    );
  }
  const props: Record<string, unknown> = projectId ? { projectId } : {};
  return <Renderer {...props} />;
}
