import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { type ScreenDef, type Panel, panelsForMethodology, visiblePanels } from "../../lib/screen";
import { PANEL_RENDERERS } from "./registry";
import { BoundPanel } from "./BoundPanel";

/**
 * ScreenRenderer — the ONE generic renderer behind screens, views and reports.
 * It lays a screen's panels onto a 12-column grid and delegates each to its
 * panel renderer by `kind`; an unknown kind (e.g. a config-folder-added one this
 * build doesn't know) degrades to a labelled placeholder instead of crashing.
 *
 * Optional `methodology` activates only the panels that methodology tags (the
 * "set throughout" preset); `caps` hides panels whose backend domain isn't fed.
 */
export function ScreenRenderer({
  screen,
  methodology,
  caps,
}: {
  screen: ScreenDef;
  methodology?: string;
  caps?: Record<string, boolean>;
}) {
  let panels = screen.panels;
  if (methodology) panels = panelsForMethodology(panels, methodology);
  panels = visiblePanels(panels, caps);

  return (
    <div className="grid grid-cols-12 gap-4" data-testid="screen-renderer" data-screen={screen.id}>
      {panels.map((panel) => {
        const span = Math.min(Math.max(panel.span ?? 12, 1), 12);
        return (
          <div key={panel.id} style={{ gridColumn: `span ${span} / span ${span}` }}>
            <PanelSlot panel={panel} />
          </div>
        );
      })}
    </div>
  );
}

/** Render one panel via its registered renderer, or a graceful placeholder. A panel
 *  with a `source` is wrapped in BoundPanel so it fetches + refreshes on its own. */
function PanelSlot({ panel }: { panel: Panel }) {
  const renderInner = (p: Panel): ReactNode => {
    const Renderer = PANEL_RENDERERS[p.kind];
    if (Renderer) return <Renderer panel={p} />;
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-muted-foreground" data-testid="unknown-panel">
            {p.title ?? p.id}: no renderer for panel kind “{p.kind}”.
          </p>
        </CardContent>
      </Card>
    );
  };
  if (panel.source) return <BoundPanel panel={panel} render={renderInner} />;
  return renderInner(panel);
}
