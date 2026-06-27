import type { ComponentType } from "react";
import type { Panel, PanelKind } from "../../lib/screen";
import { MetricPanel } from "./panels/MetricPanel";
import { TextPanel } from "./panels/TextPanel";
import { TablePanel } from "./panels/TablePanel";
import { ListPanel } from "./panels/ListPanel";
import { ViewPanel } from "./panels/ViewPanel";

/**
 * Panel-renderer registry — maps a panel `kind` to the ONE component that renders
 * it, so the ScreenRenderer stays generic and each widget is written in one place.
 * The complex kinds (board, chart, timeline, register) are registered here as the
 * existing components are wrapped as panels in later increments.
 */
export type PanelComponent = ComponentType<{ panel: Panel }>;

export const PANEL_RENDERERS: Partial<Record<PanelKind, PanelComponent>> = {
  metric: MetricPanel,
  text: TextPanel,
  table: TablePanel,
  list: ListPanel,
  // The bridge to the existing methodology views (board/Gantt/scrum/…) as panels.
  view: ViewPanel,
};

/** Whether a renderer exists for a panel kind (else it degrades to a placeholder). */
export function hasPanelRenderer(kind: PanelKind): boolean {
  return !!PANEL_RENDERERS[kind];
}
