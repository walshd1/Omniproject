import { useListProjects, useGetProjectIssues, useGetCapabilities, getGetProjectIssuesQueryKey } from "@workspace/api-client-react";
import { Link, useSearch } from "wouter";
import { useEffect, useState } from "react";
import { IssueBoardView } from "../../components/views/IssueEngineView";
import { IssueGrid } from "../../components/grid/IssueGrid";
import { useFeatures, featureEnabled } from "../../lib/features";
import { useRecentItems } from "../../lib/recent-items";
import { ExportMenu } from "../../components/ExportMenu";
import { CloseProjectDialog } from "../../components/CloseProjectDialog";
import { DataProvenance } from "../../components/DataProvenance";
import { ProjectFinancialsStrip } from "../../components/ProjectFinancialsStrip";

/** A representative spread across the field groups, to expose where issue data
 *  is sparse (people / schedule / effort / financial / agile / quality). */
const ISSUE_FIELDS = [
  { key: "assignee", label: "Assignee" },
  { key: "dueDate", label: "Due date" },
  { key: "estimateHours", label: "Estimate" },
  { key: "budget", label: "Budget" },
  { key: "storyPoints", label: "Story points" },
  { key: "healthStatus", label: "Health" },
];
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export function ProjectDetail({ projectId }: { projectId: string }) {
  const { data: projects } = useListProjects();
  const project = projects?.find((p) => p.id === projectId);
  const { data: caps } = useGetCapabilities();
  const { data: issues, dataUpdatedAt } = useGetProjectIssues(projectId, { query: { queryKey: getGetProjectIssuesQueryKey(projectId) } });
  const { data: features } = useFeatures();
  const gridEnabled = featureEnabled(features, "grid");
  // A drill-through (backlog #122, e.g. a "N blocked" figure elsewhere) lands here with a `filter`
  // query param — default straight to the grid so the pre-filtered list is what the user actually
  // sees, instead of the board (which doesn't apply the filter at all).
  const hasDrillFilter = new URLSearchParams(useSearch()).has("filter");
  const [view, setView] = useState<"board" | "grid">(hasDrillFilter ? "grid" : "board");
  const activeView = gridEnabled ? view : "board";

  // Remember this visit for the "Recent" quick-find list (findability).
  const recordRecent = useRecentItems((s) => s.record);
  useEffect(() => {
    if (project) recordRecent({ type: "project", id: project.id, label: project.name });
  }, [project, recordRecent]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-8 py-4 border-b border-border bg-card shrink-0">
        <Breadcrumb className="mb-3">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/projects">Projects</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{project?.name ?? "Project"}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex items-center gap-4">
          {project ? (
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold uppercase tracking-widest bg-foreground text-background px-2 py-0.5">
                {project.identifier}
              </span>
              <h1 className="text-xl font-black uppercase tracking-tighter">{project.name}</h1>
              <span className="text-xs px-1.5 py-0.5 border border-border bg-muted/50 uppercase tracking-widest">
                {project.source}
              </span>
            </div>
          ) : (
            <h1 className="text-xl font-black uppercase tracking-tighter">PROJECT</h1>
          )}
          <div className="ml-auto flex items-center gap-3">
            {issues && issues.length > 0 && (
              <DataProvenance rows={issues as unknown as Record<string, unknown>[]} fields={ISSUE_FIELDS} mode={caps?.mode}
                filename={`issues-${projectId}`} fieldSources={caps?.fieldSources} polledAt={dataUpdatedAt} />
            )}
            <ExportMenu projectId={projectId} />
            {project?.omniInstanceId && (
              <CloseProjectDialog projectGuid={project.omniInstanceId} projectName={project.name} source={project.source} />
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 p-8 overflow-auto">
        <ProjectFinancialsStrip projectId={projectId} />
        {gridEnabled && (
          <div className="mb-4 inline-flex border-2 border-foreground" role="tablist" aria-label="View">
            {(["board", "grid"] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={activeView === v}
                onClick={() => setView(v)}
                className={`px-3 py-1 text-xs font-bold uppercase tracking-wider ${activeView === v ? "bg-foreground text-background" : ""}`}
              >
                {v}
              </button>
            ))}
          </div>
        )}
        {activeView === "grid" ? <IssueGrid projectId={projectId} /> : <IssueBoardView projectId={projectId} />}
      </div>
    </div>
  );
}
