import { useEffect, useState, type ReactNode } from "react";
import { useListProjects, useGetCapabilities, type Capabilities } from "@workspace/api-client-react";
import { useStore } from "../store/useStore";
import { PortfolioKpi } from "../components/reports/PortfolioKpi";
import { PortfolioRoadmap } from "../components/reports/PortfolioRoadmap";
import { ResourceHeatmap } from "../components/reports/ResourceHeatmap";
import { FinancialEvmChart } from "../components/reports/FinancialEvmChart";
import { MonteCarloRisk } from "../components/reports/MonteCarloRisk";
import { CriticalPath } from "../components/reports/CriticalPath";
import { BenefitsRealisation } from "../components/reports/BenefitsRealisation";
import { CapexOpex } from "../components/reports/CapexOpex";
import { FinancialSummary } from "../components/reports/FinancialSummary";
import { StaffTimeCost } from "../components/reports/StaffTimeCost";
import { IncomeInvoicing } from "../components/reports/IncomeInvoicing";
import { CapacityRollup } from "../components/reports/CapacityRollup";
import { PortfolioFinancials } from "../components/reports/PortfolioFinancials";
import { PortfolioIncome } from "../components/reports/PortfolioIncome";
import { PortfolioBenefits } from "../components/reports/PortfolioBenefits";
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

/** Render a report only when its data domain is available; else label the dependency. */
function Gated({
  caps,
  domain,
  title,
  requires,
  children,
}: {
  caps?: Capabilities | undefined;
  domain: keyof Capabilities;
  title: string;
  requires: string;
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
  return <>{children}</>;
}

export function Reports() {
  const { t } = useT();
  const { data: projects, dataUpdatedAt } = useListProjects();
  const { data: caps } = useGetCapabilities();
  const { data: auth } = useAuth();
  const { activeProjectId, setActiveProjectId } = useStore();
  const [projectId, setProjectId] = useState(activeProjectId || "");

  useEffect(() => {
    if (!projectId && projects && projects.length > 0) {
      setProjectId(activeProjectId || projects[0]!.id); // length > 0 checked above
    }
  }, [projects, projectId, activeProjectId]);

  const onSelect = (id: string) => {
    setProjectId(id);
    setActiveProjectId(id);
  };

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

        <Gated caps={caps} domain="portfolio" title="Portfolio Health" requires="a portfolio rollup (get_portfolio_health)">
          <PortfolioKpi />
        </Gated>

        <Gated caps={caps} domain="scheduling" title="Portfolio Roadmap" requires="start / due dates on work items">
          <section>
            <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-4">Portfolio Roadmap</h2>
            <PortfolioRoadmap />
          </section>
        </Gated>

        <Gated caps={caps} domain="resources" title="Capacity Roll-up" requires="a resource-management source">
          <section>
            <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-4">Capacity Roll-up (programme &amp; portfolio)</h2>
            <CapacityRollup />
          </section>
        </Gated>

        <Gated caps={caps} domain="financials" title="Portfolio Financials" requires="a cost / ERP source">
          <section>
            <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-4">Portfolio Financials (consolidated)</h2>
            <PortfolioFinancials />
          </section>
        </Gated>

        <Gated caps={caps} domain="financials" title="Portfolio Income" requires="revenue / invoiced amounts on work items">
          <section>
            <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-4">Portfolio Income (consolidated)</h2>
            <PortfolioIncome />
          </section>
        </Gated>

        <Gated caps={caps} domain="benefits" title="Portfolio Benefits" requires="benefit value/status fields on work items">
          <section>
            <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-4">Portfolio Benefits (consolidated)</h2>
            <PortfolioBenefits />
          </section>
        </Gated>

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
          <Gated caps={caps} domain="scheduling" title="Schedule Risk (Monte Carlo)" requires="effort estimates on work items">
            <section>
              <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-4">Schedule Risk (Monte Carlo)</h2>
              <MonteCarloRisk projectId={projectId} />
            </section>
          </Gated>
        )}

        {projectId && (
          <Gated caps={caps} domain="scheduling" title="Critical Path (CPM)" requires="durations + blocks/depends-on dependencies">
            <section>
              <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-4">Critical Path (CPM)</h2>
              <CriticalPath projectId={projectId} />
            </section>
          </Gated>
        )}

        {projectId && (
          <Gated caps={caps} domain="benefits" title="Benefits Realisation" requires="benefit value/status fields on work items">
            <section>
              <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-4">Benefits Realisation</h2>
              <BenefitsRealisation projectId={projectId} />
            </section>
          </Gated>
        )}

        {projectId && (
          <Gated caps={caps} domain="financials" title="Income & Invoicing" requires="revenue / invoiced amounts on work items">
            <section>
              <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-4">Income &amp; Invoicing</h2>
              <IncomeInvoicing projectId={projectId} />
            </section>
          </Gated>
        )}

        {projectId && (
          <Gated caps={caps} domain="financials" title="CapEx / OpEx" requires="capex/opex classification on work items">
            <section>
              <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-4">CapEx / OpEx</h2>
              <CapexOpex projectId={projectId} />
            </section>
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
          <Gated caps={caps} domain="financials" title="Financial Summary" requires="a cost / ERP source">
            <section>
              <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-4">Financial Summary</h2>
              <FinancialSummary projectId={projectId} />
            </section>
          </Gated>
        )}

        {projectId && roleAtLeast(auth?.role, "pmo") && (
          <Gated caps={caps} domain="financials" title="Staff Time & Cost" requires="a cost / ERP source + a PMO rate card">
            <section>
              <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-4">Staff Time &amp; Cost</h2>
              <StaffTimeCost projectId={projectId} />
            </section>
          </Gated>
        )}

        {projectId && (
          <Gated caps={caps} domain="raid" title="RAID Register" requires="a RAID log (get_project_raid)">
            <section>
              <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-4">RAID Register</h2>
              <RaidRegister projectId={projectId} />
            </section>
          </Gated>
        )}
      </div>
    </div>
  );
}
