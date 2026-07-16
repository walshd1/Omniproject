import type { ComponentType } from "react";
import type { Panel, PanelKind } from "../../lib/screen";
import { MetricPanel } from "./panels/MetricPanel";
import { TextPanel } from "./panels/TextPanel";
import { TablePanel } from "./panels/TablePanel";
import { ListPanel } from "./panels/ListPanel";
import { ViewPanel } from "./panels/ViewPanel";
import { GraphPanel } from "./panels/GraphPanel";
import { MapPanel } from "./panels/MapPanel";
import { ChartPanel } from "./panels/ChartPanel";
import { ComponentPanel } from "./panels/ComponentPanel";
import { WidgetPanel } from "./panels/WidgetPanel";
import { RegisterPanel } from "./panels/RegisterPanel";

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
  // An EDITABLE data grid (manager+ can add/edit/delete + Save) over a settings collection — RACI,
  // stakeholders, budget lines, allocations authored ON the screen. Viewers see it read-only.
  register: RegisterPanel,
  // The bridge to the existing methodology views (board/Gantt/scrum/…) as panels.
  view: ViewPanel,
  // Charts (bar/line/area/pie) drawn from object-rows through the shared ChartView renderer.
  chart: ChartPanel,
  // New visual primitives — accessible data view today, rich rendering behind them.
  graph: GraphPanel,
  map: MapPanel,
  // Hosts a full registered SPA page/component as a panel (the escape hatch for bespoke, interactive
  // pages that would regress if rebuilt from the generic primitives). See screen-components.
  component: ComponentPanel,
  // Hosts any dashboard widget (self-contained, reads its own data) by type. See components/dashboard.
  widget: WidgetPanel,
};

/** Whether a renderer exists for a panel kind (else it degrades to a placeholder). */
export function hasPanelRenderer(kind: PanelKind): boolean {
  return !!PANEL_RENDERERS[kind];
}
