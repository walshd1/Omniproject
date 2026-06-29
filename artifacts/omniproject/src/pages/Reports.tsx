import { useEffect, useState, type ReactNode } from "react";
import { useListProjects, useGetCapabilities, type Capabilities } from "@workspace/api-client-react";
import { useStore } from "../store/useStore";
import { PortfolioKpi } from "../components/reports/PortfolioKpi";
import { ResourceHeatmap } from "../components/reports/ResourceHeatmap";
import { FinancialEvmChart } from "../components/reports/FinancialEvmChart";
import { ProjectTrend } from "../components/reports/ProjectTrend";
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
  caps?: Capabilities;
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
          <Gated caps={caps} domain="history" title="Progress Trend" requires="backend history (journals / changelog via get_project_history)">
            <ProjectTrend projectId={projectId} />
          </Gated>
        )}
      </div>
    </div>
  );
}
