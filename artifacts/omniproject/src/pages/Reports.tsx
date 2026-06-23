import { useEffect, useState } from "react";
import { useListProjects } from "@workspace/api-client-react";
import { useStore } from "../store/useStore";
import { PortfolioKpi } from "../components/reports/PortfolioKpi";
import { ResourceHeatmap } from "../components/reports/ResourceHeatmap";
import { FinancialEvmChart } from "../components/reports/FinancialEvmChart";

export function Reports() {
  const { data: projects } = useListProjects();
  const { activeProjectId, setActiveProjectId } = useStore();
  const [projectId, setProjectId] = useState(activeProjectId || "");

  useEffect(() => {
    if (!projectId && projects && projects.length > 0) {
      setProjectId(activeProjectId || projects[0].id);
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
          <h1 className="text-3xl font-black uppercase tracking-tighter">ENTERPRISE REPORTING</h1>
          {projects && projects.length > 0 && (
            <select
              className="bg-background border border-border px-3 py-2 text-sm font-bold uppercase outline-none"
              value={projectId}
              onChange={(e) => onSelect(e.target.value)}
              data-testid="reports-project-select"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
        </div>

        <PortfolioKpi />

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
          {projectId && <ResourceHeatmap projectId={projectId} />}
          {projectId && <FinancialEvmChart projectId={projectId} />}
        </div>
      </div>
    </div>
  );
}
