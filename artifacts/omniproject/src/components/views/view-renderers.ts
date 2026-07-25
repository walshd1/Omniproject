import type { ComponentType } from "react";
import { GanttChart } from "../board/GanttChart";
import { ScrumView } from "./ScrumView";
import { Prince2View } from "./Prince2View";
import { RaidView } from "./RaidView";
import { IssueEngineView, IssueBoardView, IssueListView } from "./IssueEngineView";

/**
 * The VIEW renderer registry — the view-analogue of REPORT_RENDERERS. Every built-in (methodology)
 * view is a read-only JSON definition in the catalogue, bound here to a registered renderer component.
 * `kanban`, `list` and `flow` all render issues through the ONE generic view engine (the bespoke
 * AgileBoard/ListView were retired onto it): `kanban` locks the engine to the board, `list` to the
 * sortable table, and `flow` is the full multi-view switcher. The remaining specialized views the
 * generic engine can't yet produce (Gantt timeline, PRINCE2 stages, RAID register, scrum burndown)
 * keep their own renderers, so a view definition dispatches to code exactly like a report definition.
 */
export interface ViewRendererProps {
  projectId: string;
}
export type ViewRendererComponent = ComponentType<ViewRendererProps>;

export const VIEW_RENDERERS: Record<string, ViewRendererComponent> = {
  kanban: IssueBoardView,
  scrum: ScrumView,
  gantt: GanttChart,
  prince2: Prince2View,
  raid: RaidView,
  list: IssueListView,
  flow: IssueEngineView,
};

/** Is this view id bound to a registered renderer? (Mirrors reports' isRegisteredRenderer.) */
export function isRegisteredViewRenderer(id: string | undefined): boolean {
  return !!id && id in VIEW_RENDERERS;
}
