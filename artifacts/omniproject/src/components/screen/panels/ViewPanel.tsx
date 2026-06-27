import { Card, CardContent } from "@/components/ui/card";
import { VIEW_COMPONENTS } from "../../views/registry";
import { isViewId } from "../../../lib/views";
import type { Panel } from "../../../lib/screen";

/**
 * View panel — the bridge that lets a screen host any existing methodology view
 * (Kanban board, Gantt, Scrum, PRINCE2, RAID, List) as a panel. config:
 * { view: ViewId, projectId }. The heavy view components are reused unchanged and
 * self-fetch via their own hooks, so the renderer needs no data plumbing — this is
 * how "write the board / Gantt once" pays off under the one ScreenRenderer.
 */
export function ViewPanel({ panel }: { panel: Panel }) {
  const view = String(panel.config?.["view"] ?? "");
  const projectId = String(panel.config?.["projectId"] ?? "");

  if (!isViewId(view)) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-muted-foreground" data-testid="unknown-view">Unknown view “{view}”.</p>
        </CardContent>
      </Card>
    );
  }

  const ViewComponent = VIEW_COMPONENTS[view];
  return (
    <div data-testid="view-panel" data-view={view}>
      <ViewComponent projectId={projectId} />
    </div>
  );
}
