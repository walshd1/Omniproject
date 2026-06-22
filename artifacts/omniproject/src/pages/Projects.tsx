import { useListProjects, useGetProjectSummary } from "@workspace/api-client-react";
import { Link } from "wouter";

function ProjectSummaryCard({ projectId }: { projectId: string }) {
  const { data: summary, isLoading } = useGetProjectSummary(projectId);

  if (isLoading) {
    return <div className="h-12 bg-muted/50 animate-pulse border border-border mt-4"></div>;
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
  const { data: projects, isLoading } = useListProjects();

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-border">
          <h1 className="text-3xl font-black uppercase tracking-tighter">PROJECTS INDEX</h1>
          <div className="text-muted-foreground font-mono text-sm">TOTAL: {projects?.length || 0}</div>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-40 bg-card border border-border animate-pulse" />
            ))}
          </div>
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
      </div>
    </div>
  );
}
