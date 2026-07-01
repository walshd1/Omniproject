import type { ComponentType } from "react";
import type { ReportDefinition } from "@workspace/backend-catalogue";
import { PortfolioKpi } from "./PortfolioKpi";
import { ResourceHeatmap } from "./ResourceHeatmap";
import { CapacityRollup } from "./CapacityRollup";
import { FinancialEvmChart } from "./FinancialEvmChart";
import { FinancialSummary } from "./FinancialSummary";
import { PortfolioFinancials } from "./PortfolioFinancials";
import { PortfolioIncome } from "./PortfolioIncome";
import { PortfolioBenefits } from "./PortfolioBenefits";
import { IncomeInvoicing } from "./IncomeInvoicing";
import { StaffTimeCost } from "./StaffTimeCost";
import { Burndown } from "./Burndown";
import { Burnup } from "./Burnup";
import { CumulativeFlow } from "./CumulativeFlow";
import { Velocity } from "./Velocity";
import { RaidRegister } from "./RaidRegister";

/**
 * The report RENDERER REGISTRY — the one place a report definition's `renderer.component` is resolved to
 * a real React component. Every built-in report is a JSON definition (see the catalogue) bound here to a
 * registered renderer, so the only report logic left in code is these reusable components + the no-code
 * engine/editor. The coverage guard checks that every `engine:"builtin"` report's component is registered
 * here, keeping the JSON↔code binding honest.
 *
 * Renderers have heterogeneous props (some are project-scoped, taking `projectId`; some are portfolio-wide,
 * taking none), so the registry value type is intentionally loose — the caller supplies the right props.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReportRendererComponent = ComponentType<any>;

export const REPORT_RENDERERS: Record<string, ReportRendererComponent> = {
  PortfolioKpi,
  ResourceHeatmap,
  CapacityRollup,
  FinancialEvmChart,
  FinancialSummary,
  PortfolioFinancials,
  PortfolioIncome,
  PortfolioBenefits,
  IncomeInvoicing,
  StaffTimeCost,
  Burndown,
  Burnup,
  CumulativeFlow,
  Velocity,
  RaidRegister,
};

/** Is this component name a registered renderer? */
export function isRegisteredRenderer(component: string | undefined): boolean {
  return !!component && component in REPORT_RENDERERS;
}

/**
 * Resolve a report definition to its renderer component, or null when it has no registered on-page
 * renderer: a `custom`-engine report (drawn by the generic CustomReport engine) or a `surfacedVia`
 * exception (reached through another plane, e.g. the Gantt board view).
 */
export function resolveReportRenderer(def: Pick<ReportDefinition, "renderer">): ReportRendererComponent | null {
  const r = def.renderer;
  if (!r || r.engine !== "builtin" || r.surfacedVia || !r.component) return null;
  return REPORT_RENDERERS[r.component] ?? null;
}
