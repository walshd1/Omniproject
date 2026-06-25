import { useListProjects, useGetProjectSummary } from "@workspace/api-client-react";
import { Link } from "wouter";
import { PlugZap } from "lucide-react";
import { ExportMenu } from "../components/ExportMenu";
import { DataState } from "../components/DataState";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty";

function ProjectSummaryCard({ projectId }: { projectId: string }) {
  const { data: summary, isLoading, isError } = useGetProjectSummary(projectId);

  if (isLoading) {
    return <div className="h-12 bg-muted/50 animate-pulse border border-border mt-4"></div>;
  }

  if (isError) {
    // The card is wrapped in a pointer-events-none overlay link, so a Retry
    // button can't be clicked here; surface a compact accessible notice instead
    // (the project link still navigates to the full detail view).
    return (
      <div role="alert" className="mt-4 border border-red-500/40 bg-red-500/5 px-4 py-3 text-xs font-mono text-red-500">
        Could not load summary.
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="mt-4 grid grid-cols-4 gap-4 text-sm font-mono border border-border p-4 bg-background">
      <div>
        <div className="text-muted-foreground mb-1 text-xs">TOTAL ISSUES</div>
        <div className="font-bold text-lg">{summary.total}</div>
      </div>
      <div>
        <div className="text-muted-foreground mb-1 text-xs">COMPLETION</div>
        <div className="font-bold text-lg text-green-500">{summary.completionRate}%</div>
      </div>
      <div>
        <div className="text-muted-foreground mb-1 text-xs">OVERDUE</div>
        <div className="font-bold text-lg text-red-500">{summary.overdue}</div>
      </div>
      <div>
        <div className="text-muted-foreground mb-1 text-xs">TODO / IN PROGRESS</div>
        <div className="font-bold text-lg">
          {summary.byStatus?.todo || 0} / {summary.byStatus?.in_progress || 0}
        </div>
      </div>
    </div>
  );
}

export function Projects() {
  const { data: projects, isLoading, isError, error, refetch } = useListProjects();

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-border">
          <h1 className="text-3xl font-black uppercase tracking-tighter">PROJECTS INDEX</h1>
          <div className="flex items-center gap-4">
            <div className="text-muted-foreground font-mono text-sm">TOTAL: {projects?.length || 0}</div>
            <ExportMenu />
          </div>
        </div>

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
                  <ProjectSummaryCard projectId={project.id} />
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
