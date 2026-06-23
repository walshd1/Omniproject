import { useListProjects } from "@workspace/api-client-react";
import { Link } from "wouter";
import { ChevronLeft } from "lucide-react";
import { AgileBoard } from "../components/board/AgileBoard";
import { ExportMenu } from "../components/ExportMenu";

export function ProjectDetail({ projectId }: { projectId: string }) {
  const { data: projects } = useListProjects();
  const project = projects?.find((p) => p.id === projectId);

  return (
    <div className="h-full flex flex-col">
      <div className="px-8 py-4 border-b border-border bg-card shrink-0 flex items-center gap-4">
        <Link href="/projects" className="text-muted-foreground hover:text-foreground" aria-label="Back to projects">
          <ChevronLeft className="w-5 h-5" />
        </Link>
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
        <div className="ml-auto">
          <ExportMenu projectId={projectId} />
        </div>
      </div>

      <div className="flex-1 p-8 overflow-auto">
        <AgileBoard projectId={projectId} />
      </div>
    </div>
  );
}
