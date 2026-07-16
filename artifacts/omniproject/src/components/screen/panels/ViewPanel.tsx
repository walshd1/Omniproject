import { Card, CardContent } from "@/components/ui/card";
import { VIEW_COMPONENTS } from "../../views/registry";
import { isViewId } from "../../../lib/views";
import { useStore } from "../../../store/useStore";
import type { Panel } from "../../../lib/screen";

/**
 * View panel — the bridge that lets a screen host any existing methodology view
 * (Kanban board, Gantt, Scrum, PRINCE2, RAID, List) as a panel. config:
 * { view: ViewId, projectId? }. The heavy view components are reused unchanged and
 * self-fetch via their own hooks, so the renderer needs no data plumbing — this is
 * how "write the board / Gantt once" pays off under the one ScreenRenderer.
 *
 * `projectId` may be omitted; it then falls back to the session's active project (the
 * same one the sidebar/project selector drives), so a view panel works on a screen
 * that isn't a project-detail route.
 */
export function ViewPanel({ panel }: { panel: Panel }) {
  const activeProjectId = useStore((s) => s.activeProjectId);
  const view = String(panel.config?.["view"] ?? "");
  const projectId = String(panel.config?.["projectId"] ?? activeProjectId ?? "");

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
