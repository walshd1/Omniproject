import { useListProjects, useGetCapabilities, type Project } from "@workspace/api-client-react";
import { Link } from "wouter";
import { useState } from "react";
import { PlugZap, Plus } from "lucide-react";
import { ExportMenu } from "../components/ExportMenu";
import { DataProvenance } from "../components/DataProvenance";
import { NewProjectDialog } from "../components/NewProjectDialog";
import { canStoreEntity } from "../lib/capabilities-fields";

/** The list-row fields whose fill rate is worth surfacing on the index. */
const PROJECT_FIELDS = [
  { key: "description", label: "Description" },
  { key: "programmeName", label: "Programme" },
  { key: "memberCount", label: "Members" },
  { key: "issueCount", label: "Issues" },
];
import { Button } from "@/components/ui/button";
import { DataState } from "../components/DataState";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty";

function ProjectSummaryCard({ project }: { project: Project }) {
  // Render straight from the list row's issueCount/completedCount to avoid an
  // N+1 of per-card useGetProjectSummary broker round-trips on the index page.
  // Summary-only fields (overdue, byStatus) aren't on the list row, so we show
  // only what the row provides; the project link navigates to full detail.
  const completion =
    project.issueCount > 0 ? Math.round((project.completedCount / project.issueCount) * 100) : 0;

  return (
    <div className="mt-4 grid grid-cols-3 gap-4 text-sm font-mono border border-border p-4 bg-background">
      <div>
        <div className="text-muted-foreground mb-1 text-xs">TOTAL ISSUES</div>
        <div className="font-bold text-lg">{project.issueCount}</div>
      </div>
      <div>
        <div className="text-muted-foreground mb-1 text-xs">COMPLETED</div>
        <div className="font-bold text-lg">{project.completedCount}</div>
      </div>
      <div>
        <div className="text-muted-foreground mb-1 text-xs">COMPLETION</div>
        <div className="font-bold text-lg text-green-500">{completion}%</div>
      </div>
    </div>
  );
}

export function Projects() {
  const { data: projects, isLoading, isError, error, refetch, dataUpdatedAt } = useListProjects();
  const { data: caps } = useGetCapabilities();
  const [newOpen, setNewOpen] = useState(false);
  const canCreate = canStoreEntity(caps, "project");

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-border">
          <h1 className="text-3xl font-black uppercase tracking-tighter">PROJECTS INDEX</h1>
          <div className="flex items-center gap-4">
            <div className="text-muted-foreground font-mono text-sm">TOTAL: {projects?.length || 0}</div>
            {canCreate && (
              <Button
                onClick={() => setNewOpen(true)}
                className="rounded-none uppercase font-bold tracking-wider text-xs gap-1.5"
              >
                <Plus className="w-4 h-4" /> New Project
              </Button>
            )}
            {projects && projects.length > 0 && (
              <DataProvenance rows={projects as unknown as Record<string, unknown>[]} fields={PROJECT_FIELDS} mode={caps?.mode}
                filename="projects" fieldSources={caps?.fieldSources} polledAt={dataUpdatedAt} />
            )}
            <ExportMenu />
          </div>
        </div>

        <NewProjectDialog open={newOpen} onOpenChange={setNewOpen} />

        {isLoading ? (
          <div className="flex flex-col gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-40 bg-card border border-border animate-pulse" />
            ))}
          </div>
        ) : (
          <DataState isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
          {projects && projects.length === 0 ? (
            <Empty className="border-2 border-border bg-card min-h-40">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <PlugZap />
                </EmptyMedia>
                <EmptyTitle>No projects yet</EmptyTitle>
                <EmptyDescription>
                  Connect your backend in Setup to start pulling projects and issues into OmniProject.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Link
                  href="/setup"
                  className="inline-flex items-center gap-2 bg-primary text-primary-foreground border border-primary px-4 py-2 text-sm font-bold uppercase tracking-wider hover:bg-primary/90"
                >
                  <PlugZap className="w-4 h-4" /> Go to Setup
                </Link>
              </EmptyContent>
            </Empty>
          ) : (
          <div className="flex flex-col gap-6">
            {projects?.map(project => (
              <div key={project.id} className="bg-card border-2 border-border p-6 hover:border-primary transition-colors group relative">
                <Link href={`/projects/${project.id}`} className="absolute inset-0 z-10" />
                
                <div className="flex items-start justify-between mb-2 relative z-20 pointer-events-none">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xs font-bold uppercase tracking-widest bg-foreground text-background px-2 py-0.5">
                        {project.identifier}
                      </span>
                      <h2 className="text-xl font-bold">{project.name}</h2>
                    </div>
                    {project.description && (
                      <p className="text-muted-foreground text-sm max-w-2xl">{project.description}</p>
                    )}
                  </div>
                  
                  <div className="text-xs font-bold uppercase tracking-widest border border-border px-2 py-1 bg-background text-primary">
                    {project.source}
                  </div>
                </div>

                <div className="relative z-20 pointer-events-none">
                  <ProjectSummaryCard project={project} />
                </div>
              </div>
            ))}
          </div>
          )}
          </DataState>
        )}
      </div>
    </div>
  );
}
