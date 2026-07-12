import type { ComponentType } from "react";
import { AgileBoard } from "../board/AgileBoard";
import { GanttChart } from "../board/GanttChart";
import { ScrumView } from "./ScrumView";
import { Prince2View } from "./Prince2View";
import { RaidView } from "./RaidView";
import { ListView } from "./ListView";
import { IssueEngineView } from "./IssueEngineView";

/**
 * The VIEW renderer registry — the view-analogue of REPORT_RENDERERS. Every built-in (methodology)
 * view is a read-only JSON definition in the catalogue, bound here to a registered renderer component.
 * The specialized views the generic engine can't produce (Gantt timeline, PRINCE2 stages, RAID
 * register, scrum board) live here as their kind's renderer, so a view definition dispatches to code
 * exactly the way a report definition does. `flow` renders issues through the generic engine.
 */
export interface ViewRendererProps {
  projectId: string;
}
export type ViewRendererComponent = ComponentType<ViewRendererProps>;

export const VIEW_RENDERERS: Record<string, ViewRendererComponent> = {
  kanban: AgileBoard,
  scrum: ScrumView,
  gantt: GanttChart,
  prince2: Prince2View,
  raid: RaidView,
  list: ListView,
  flow: IssueEngineView,
};

/** Is this view id bound to a registered renderer? (Mirrors reports' isRegisteredRenderer.) */
export function isRegisteredViewRenderer(id: string | undefined): boolean {
  return !!id && id in VIEW_RENDERERS;
}
