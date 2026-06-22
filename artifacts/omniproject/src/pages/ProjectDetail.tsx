import { useGetProjectIssues, useUpdateIssue } from "@workspace/api-client-react";
import { STATUS_LABELS, STATUS_COLORS, PRIORITY_COLORS } from "../lib/constants";
import { format } from "date-fns";

export function ProjectDetail({ projectId }: { projectId: string }) {
  const { data: issues, isLoading } = useGetProjectIssues(projectId);
  const updateIssue = useUpdateIssue();

  if (isLoading) return <div className="p-8 text-center font-bold tracking-widest text-muted-foreground">LOADING...</div>;

  return (
    <div className="h-full p-8 overflow-auto">
      <div className="flex gap-6 h-full min-w-max pb-8">
        {Object.entries(STATUS_LABELS).map(([status, label]) => {
          const statusIssues = issues?.filter(i => i.status === status) || [];
          
          return (
            <div key={status} className="w-80 flex flex-col shrink-0 bg-card border-t-4 border-t-zinc-700 border-x border-b border-border">
              <div className="p-3 border-b border-border bg-background flex items-center justify-between">
                <span className="font-bold text-sm tracking-wider">{label}</span>
                <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5">{statusIssues.length}</span>
              </div>
              
              <div className="flex-1 p-3 flex flex-col gap-3 overflow-y-auto">
                {statusIssues.map(issue => (
                  <div key={issue.id} className="bg-background border border-border p-3 hover:border-primary cursor-pointer group">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${PRIORITY_COLORS[issue.priority]}`} />
                        <span className="text-xs text-muted-foreground uppercase font-mono">{issue.id.slice(0,8)}</span>
                      </div>
                    </div>
                    <div className="font-semibold text-sm mb-3 group-hover:text-primary transition-colors">{issue.title}</div>
                    <div className="flex items-center justify-between mt-auto pt-3 border-t border-border">
                      <div className="flex items-center gap-1">
                        {issue.labels.map(l => (
                          <span key={l} className="text-[10px] bg-muted px-1 py-0.5 text-muted-foreground uppercase">{l}</span>
                        ))}
                      </div>
                      {issue.assignee && (
                        <div className="w-5 h-5 rounded-full bg-foreground text-background flex items-center justify-center text-[10px] font-bold">
                          {issue.assignee[0]}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}