import type { ComponentType } from "react";
import type { ViewId } from "../../lib/views";
import { AgileBoard } from "../board/AgileBoard";
import { GanttChart } from "../board/GanttChart";
import { ScrumView } from "./ScrumView";
import { Prince2View } from "./Prince2View";
import { RaidView } from "./RaidView";
import { ListView } from "./ListView";
import { IssueEngineView } from "./IssueEngineView";

/** Maps each registered view to its renderer. Kanban/Gantt reuse the existing board components;
 *  `flow` renders issues through the shared generic view engine (the same views tasks use). */
export const VIEW_COMPONENTS: Record<ViewId, ComponentType<{ projectId: string }>> = {
  kanban: AgileBoard,
  scrum: ScrumView,
  gantt: GanttChart,
  prince2: Prince2View,
  raid: RaidView,
  list: ListView,
  flow: IssueEngineView,
};
