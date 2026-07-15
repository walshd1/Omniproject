import type { ComponentType } from "react";
import type { ReportDefinition } from "@workspace/backend-catalogue";
import { PortfolioKpi } from "./PortfolioKpi";
import { ResourceHeatmap } from "./ResourceHeatmap";
import { CapacityRollup } from "./CapacityRollup";
import { ResourceLevelling } from "./ResourceLevelling";
import { FinancialEvmChart } from "./FinancialEvmChart";
import { FinancialSummary } from "./FinancialSummary";
import { PortfolioFinancials } from "./PortfolioFinancials";
import { PortfolioIncome } from "./PortfolioIncome";
import { PortfolioBenefits } from "./PortfolioBenefits";
import { PortfolioPrioritisation } from "./PortfolioPrioritisation";
import { IncomeInvoicing } from "./IncomeInvoicing";
import { StaffTimeCost } from "./StaffTimeCost";
import { Burndown } from "./Burndown";
import { Burnup } from "./Burnup";
import { CumulativeFlow } from "./CumulativeFlow";
import { Velocity } from "./Velocity";
import { RaidRegister } from "./RaidRegister";
import { CrossProgrammeDependencies } from "./CrossProgrammeDependencies";
import { FederatedPortfolio } from "./FederatedPortfolio";
import { StrategyAlignment } from "./StrategyAlignment";
import { ProjectHealth } from "./ProjectHealth";
import { DemandIntake } from "./DemandIntake";
import { Utilisation } from "./Utilisation";
import { ValueStreamFlow } from "./ValueStreamFlow";
import { ExecBoardPack } from "./ExecBoardPack";
import { PortfolioRoadmap } from "./PortfolioRoadmap";
import { CriticalPath } from "./CriticalPath";
import { ScheduleSandbox } from "./ScheduleSandbox";
import { ScenarioSandbox } from "./ScenarioSandbox";
import { DependencyLinks } from "./DependencyLinks";
import { PortfolioTrends } from "./PortfolioTrends";
import { ProjectTrend } from "./ProjectTrend";
import { BenefitsRealisation } from "./BenefitsRealisation";
import { BenefitsRealisationRollup } from "./BenefitsRealisationRollup";
import { CapexOpex } from "./CapexOpex";
import { ForecastWindows } from "./ForecastWindows";
import { MonteCarloRisk } from "./MonteCarloRisk";

/**
 * The report RENDERER REGISTRY — the one place a report definition's `renderer.component` is resolved to
 * a real React component. Every built-in report is a JSON definition (see the catalogue) bound here to a
 * registered renderer, so the only report logic left in code is these reusable components + the no-code
 * engine/editor. The coverage guard checks that every `engine:"builtin"` report's component is registered
 * here, keeping the JSON↔code binding honest.
 *
 * Renderers have heterogeneous props: project-scoped ones read `projectId`; portfolio-wide ones take
 * no props and simply ignore it. A single shared prop shape keeps the registry uniformly typed — every
 * renderer is assignable to it, and the caller passes the right props for the surface it renders on.
 */
export interface ReportRendererProps {
  /** Set for project-scoped renderers (e.g. the EVM chart); ignored by portfolio-wide renderers. */
  projectId: string;
}

export type ReportRendererComponent = ComponentType<ReportRendererProps>;

export const REPORT_RENDERERS: Record<string, ReportRendererComponent> = {
  PortfolioKpi,
  ResourceHeatmap,
  CapacityRollup,
  ResourceLevelling,
  FinancialEvmChart,
  FinancialSummary,
  PortfolioFinancials,
  PortfolioIncome,
  PortfolioBenefits,
  PortfolioPrioritisation,
  IncomeInvoicing,
  StaffTimeCost,
  Burndown,
  Burnup,
  CumulativeFlow,
  Velocity,
  RaidRegister,
  CrossProgrammeDependencies,
  FederatedPortfolio,
  StrategyAlignment,
  ProjectHealth,
  DemandIntake,
  Utilisation,
  ValueStreamFlow,
  ExecBoardPack,
  PortfolioRoadmap,
  CriticalPath,
  ScheduleSandbox,
  ScenarioSandbox,
  DependencyLinks,
  PortfolioTrends,
  ProjectTrend,
  BenefitsRealisation,
  // Rollup takes only an optional `now` (test seam) and no projectId; adapt it to the shared prop shape.
  BenefitsRealisationRollup: BenefitsRealisationRollup as ReportRendererComponent,
  CapexOpex,
  ForecastWindows,
  MonteCarloRisk,
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
