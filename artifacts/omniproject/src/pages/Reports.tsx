import type { ReactNode } from "react";
import { useListProjects, useGetCapabilities, type Capabilities } from "@workspace/api-client-react";
import { useActiveProjectSelector } from "../hooks/use-active-project-selector";
import { ExecBoardPack } from "../components/reports/ExecBoardPack";
import { PortfolioKpi } from "../components/reports/PortfolioKpi";
import { FederatedPortfolio } from "../components/reports/FederatedPortfolio";
import { PortfolioRoadmap } from "../components/reports/PortfolioRoadmap";
import { CrossProgrammeDependencies } from "../components/reports/CrossProgrammeDependencies";
import { ResourceHeatmap } from "../components/reports/ResourceHeatmap";
import { FinancialEvmChart } from "../components/reports/FinancialEvmChart";
import { ForecastWindows } from "../components/reports/ForecastWindows";
import { MonteCarloRisk } from "../components/reports/MonteCarloRisk";
import { CriticalPath } from "../components/reports/CriticalPath";
import { BenefitsRealisation } from "../components/reports/BenefitsRealisation";
import { CapexOpex } from "../components/reports/CapexOpex";
import { FinancialSummary } from "../components/reports/FinancialSummary";
import { StaffTimeCost } from "../components/reports/StaffTimeCost";
import { IncomeInvoicing } from "../components/reports/IncomeInvoicing";
import { CapacityRollup } from "../components/reports/CapacityRollup";
import { ResourceLevelling } from "../components/reports/ResourceLevelling";
import { PortfolioFinancials } from "../components/reports/PortfolioFinancials";
import { PortfolioIncome } from "../components/reports/PortfolioIncome";
import { PortfolioBenefits } from "../components/reports/PortfolioBenefits";
import { PortfolioPrioritisation } from "../components/reports/PortfolioPrioritisation";
import { BenefitsRealisationRollup } from "../components/reports/BenefitsRealisationRollup";
import { CustomReportsProject, CustomReportsPortfolio } from "../components/reports/CustomReportsPanel";
import { SnapshotVerifyPanel } from "../components/reports/SnapshotControls";
import { ProjectTrend } from "../components/reports/ProjectTrend";
import { Burndown } from "../components/reports/Burndown";
import { Burnup } from "../components/reports/Burnup";
import { CumulativeFlow } from "../components/reports/CumulativeFlow";
import { Velocity } from "../components/reports/Velocity";
import { RaidRegister } from "../components/reports/RaidRegister";
import { useAuth, roleAtLeast } from "../lib/auth";
import { ProvenanceBadge } from "../components/ProvenanceBadge";
import { DataProvenance } from "../components/DataProvenance";
import { useT } from "../lib/i18n";

const REPORT_PROJECT_FIELDS = [
  { key: "programmeName", label: "Programme" },
  { key: "issueCount", label: "Issues" },
  { key: "completedCount", label: "Completed" },
  { key: "memberCount", label: "Members" },
];
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Render a report only when its data domain is available; else label the dependency.
 *  With `section`, wraps the children in the standard `<section><h2>…</h2>` block used by most
 *  reports (the heading defaults to `title`; pass `heading` when the section heading differs from
 *  the shorter dependency label). Without it, children render bare. */
function Gated({
  caps,
  domain,
  title,
  requires,
  section = false,
  heading,
  children,
}: {
  caps?: Capabilities | undefined;
  domain: keyof Capabilities;
  title: string;
  requires: string;
  section?: boolean;
  heading?: ReactNode;
  children: ReactNode;
}) {
  // Render until capabilities load; only block when explicitly unavailable.
  if (caps && caps[domain] === false) {
    return (
      <section>
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-4">{title}</h2>
        <div className="bg-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Not available for this backend — requires {requires} wired through the broker.
        </div>
      </section>
    );
  }
  if (section) {
    return (
      <section>
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-4">{heading ?? title}</h2>
        {children}
      </section>
    );
  }
  return <>{children}</>;
}

export function Reports() {
  const { t } = useT();
  const { data: projects, dataUpdatedAt } = useListProjects();
  const { data: caps } = useGetCapabilities();
  const { data: auth } = useAuth();
  const { projectId, onSelect } = useActiveProjectSelector(projects);

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-6xl mx-auto space-y-10">
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-black uppercase tracking-tighter">{t("reports.title")}</h1>
            {caps && <ProvenanceBadge mode={caps.mode} />}
          </div>
          {projects && projects.length > 0 && (
            <div className="flex items-center gap-3">
              <DataProvenance rows={projects as unknown as Record<string, unknown>[]} fields={REPORT_PROJECT_FIELDS} mode={caps?.mode}
                filename="reports-portfolio" fieldSources={caps?.fieldSources} polledAt={dataUpdatedAt} />
              <Select value={projectId} onValueChange={onSelect}>
                <SelectTrigger
                  aria-label="Report project"
                  className="w-auto rounded-none bg-background border-border px-3 py-2 text-sm font-bold uppercase gap-2"
                  data-testid="reports-project-select"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-none border-border font-bold uppercase">
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <Gated caps={caps} domain="portfolio" title="Executive Board Pack" requires="a portfolio rollup (get_portfolio_health)" section>
          <ExecBoardPack />
        </Gated>

        <Gated caps={caps} domain="portfolio" title="Portfolio Health" requires="a portfolio rollup (get_portfolio_health)">
          <PortfolioKpi />
        </Gated>

        <Gated caps={caps} domain="portfolio" title="Federated Portfolio" requires="a portfolio rollup (get_portfolio_health)" section heading="Federated Portfolio (cross-instance)">
          <FederatedPortfolio />
        </Gated>

        <Gated caps={caps} domain="portfolio" title="Portfolio Prioritisation" requires="a portfolio rollup (get_portfolio_health)" section heading="Portfolio Prioritisation & Funding Funnel">
          <PortfolioPrioritisation />
        </Gated>

        <Gated caps={caps} domain="scheduling" title="Portfolio Roadmap" requires="start / due dates on work items" section>
          <PortfolioRoadmap />
        </Gated>

        <Gated caps={caps} domain="scheduling" title="Cross-programme Dependencies" requires="depends-on links + start / due dates on work items" section heading="Cross-programme Dependency & Critical-Path Map">
          <CrossProgrammeDependencies />
        </Gated>

        <Gated caps={caps} domain="resources" title="Capacity Roll-up" requires="a resource-management source" section heading="Capacity Roll-up (programme & portfolio)">
          <CapacityRollup />
        </Gated>

        <Gated caps={caps} domain="resources" title="Cross-programme Resource Levelling" requires="a resource-management source" section>
          <ResourceLevelling />
        </Gated>

        <Gated caps={caps} domain="financials" title="Portfolio Financials" requires="a cost / ERP source" section heading="Portfolio Financials (consolidated)">
          <PortfolioFinancials />
        </Gated>

        <Gated caps={caps} domain="financials" title="Portfolio Income" requires="revenue / invoiced amounts on work items" section heading="Portfolio Income (consolidated)">
          <PortfolioIncome />
        </Gated>

        <Gated caps={caps} domain="benefits" title="Portfolio Benefits" requires="benefit value/status fields on work items" section heading="Portfolio Benefits (consolidated)">
          <PortfolioBenefits />
        </Gated>

        <Gated caps={caps} domain="benefits" title="Benefits Realisation" requires="benefit value/status/due-date fields on work items" section heading="Benefits Realisation (pipeline & trajectory)">
          <BenefitsRealisationRollup />
        </Gated>

        {/* Customer-built portfolio reports (the report generator). Render nothing unless any are defined. */}
        <CustomReportsPortfolio />

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
          {projectId && (
            <Gated caps={caps} domain="resources" title="Resource Allocation" requires="a resource-management source">
              <ResourceHeatmap projectId={projectId} />
            </Gated>
          )}
          {projectId && (
            <Gated caps={caps} domain="financials" title="Earned Value (EVM)" requires="a cost / ERP source">
              <FinancialEvmChart projectId={projectId} />
            </Gated>
          )}
        </div>

        {projectId && (
          <Gated caps={caps} domain="financials" title="Forecasting Windows" requires="a cost / ERP source + work-item dates" section heading="Forecasting Windows (time-phased S-curve)">
            <ForecastWindows projectId={projectId} />
          </Gated>
        )}

        {projectId && (
          <Gated caps={caps} domain="scheduling" title="Schedule Risk (Monte Carlo)" requires="effort estimates on work items" section>
            <MonteCarloRisk projectId={projectId} />
          </Gated>
        )}

        {projectId && (
          <Gated caps={caps} domain="scheduling" title="Critical Path (CPM)" requires="durations + blocks/depends-on dependencies" section>
            <CriticalPath projectId={projectId} />
          </Gated>
        )}

        {projectId && (
          <Gated caps={caps} domain="benefits" title="Benefits Realisation" requires="benefit value/status fields on work items" section>
            <BenefitsRealisation projectId={projectId} />
          </Gated>
        )}

        {projectId && (
          <Gated caps={caps} domain="financials" title="Income & Invoicing" requires="revenue / invoiced amounts on work items" section heading="Income &amp; Invoicing">
            <IncomeInvoicing projectId={projectId} />
          </Gated>
        )}

        {projectId && (
          <Gated caps={caps} domain="financials" title="CapEx / OpEx" requires="capex/opex classification on work items" section>
            <CapexOpex projectId={projectId} />
          </Gated>
        )}

        {projectId && (
          <Gated caps={caps} domain="history" title="Progress Trend" requires="backend history (journals / changelog via get_project_history)">
            <ProjectTrend projectId={projectId} />
          </Gated>
        )}

        {projectId && (
          <Gated caps={caps} domain="history" title="Sprint Burndown" requires="backend history (get_project_history)">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
              <Burndown projectId={projectId} />
              <Burnup projectId={projectId} />
            </div>
          </Gated>
        )}

        {projectId && (
          <Gated caps={caps} domain="history" title="Flow & Velocity" requires="backend history (get_project_history)">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
              <CumulativeFlow projectId={projectId} />
              <Velocity projectId={projectId} />
            </div>
          </Gated>
        )}

        {projectId && (
          <Gated caps={caps} domain="financials" title="Financial Summary" requires="a cost / ERP source" section>
            <FinancialSummary projectId={projectId} />
          </Gated>
        )}

        {projectId && roleAtLeast(auth?.role, "pmo") && (
          <Gated caps={caps} domain="financials" title="Staff Time & Cost" requires="a cost / ERP source + a PMO rate card" section heading="Staff Time &amp; Cost">
            <StaffTimeCost projectId={projectId} />
          </Gated>
        )}

        {projectId && (
          <Gated caps={caps} domain="raid" title="RAID Register" requires="a RAID log (get_project_raid)" section>
            <RaidRegister projectId={projectId} />
          </Gated>
        )}

        {/* Customer-built project reports (the report generator). Render nothing unless any are defined. */}
        {projectId && <CustomReportsProject projectId={projectId} />}

        {/* Provably-immutable snapshots — verify a previously captured & downloaded bundle. Stateless;
            nothing is stored. Capture lives on the reports that produce a board pack (e.g. Portfolio Financials). */}
        <section>
          <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-2">Snapshot verification</h2>
          <p className="text-[11px] text-muted-foreground mb-4 max-w-2xl">
            Re-check a snapshot you previously captured &amp; downloaded — it recomputes the content hash and
            checks the signature, proving the figures are authentic and unaltered. Nothing is uploaded or stored.
          </p>
          <SnapshotVerifyPanel />
        </section>
      </div>
    </div>
  );
}
