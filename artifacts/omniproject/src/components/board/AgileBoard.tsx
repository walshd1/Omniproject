import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetProjectIssues,
  useUpdateIssue,
  getGetProjectIssuesQueryKey,
  getGetProjectSummaryQueryKey,
  getListActivityQueryKey,
  type Issue,
} from "@workspace/api-client-react";
import { Plus } from "lucide-react";
import {
  STATUS_ORDER,
  STATUS_LABELS,
  STATUS_ACCENTS,
  PRIORITY_COLORS,
} from "../../lib/constants";
import { IssueDialog } from "../IssueDialog";
import { useToast } from "@/hooks/use-toast";

function IssueCard({
  issue,
  onClick,
  onDragStart,
}: {
  issue: Issue;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="bg-background border border-border p-3 hover:border-primary cursor-pointer group active:cursor-grabbing outline-none focus-visible:border-primary"
      data-testid={`issue-card-${issue.id}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${PRIORITY_COLORS[issue.priority]}`} title={issue.priority} />
          <span className="text-xs text-muted-foreground uppercase font-mono">{issue.id.slice(0, 8)}</span>
        </div>
      </div>
      <div className="font-semibold text-sm mb-3 group-hover:text-primary transition-colors">{issue.title}</div>
      <div className="flex items-center justify-between mt-auto pt-3 border-t border-border">
        <div className="flex items-center gap-1 flex-wrap">
          {issue.labels.map((l) => (
            <span key={l} className="text-[10px] bg-muted px-1 py-0.5 text-muted-foreground uppercase">{l}</span>
          ))}
        </div>
        {issue.assignee && (
          <div
            className="w-5 h-5 rounded-full bg-foreground text-background flex items-center justify-center text-[10px] font-bold shrink-0"
            title={issue.assignee}
          >
            {issue.assignee[0].toUpperCase()}
          </div>
        )}
      </div>
    </div>
  );
}

export function AgileBoard({ projectId }: { projectId: string }) {
  const { data: issues, isLoading } = useGetProjectIssues(projectId);
  const updateIssue = useUpdateIssue();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIssue, setEditingIssue] = useState<Issue | null>(null);
  const [createStatus, setCreateStatus] = useState<string>("backlog");
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetProjectIssuesQueryKey(projectId) });
    queryClient.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
    queryClient.invalidateQueries({ queryKey: getListActivityQueryKey() });
  };

  const moveIssue = (issue: Issue, status: string) => {
    if (issue.status === status) return;
    updateIssue.mutate(
      { projectId, issueId: issue.id, data: { status: status as Issue["status"] } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "ISSUE MOVED", description: `${issue.id.slice(0, 8)} → ${STATUS_LABELS[status]}` });
        },
        onError: () => toast({ title: "ERROR", description: "Failed to move issue.", variant: "destructive" }),
      },
    );
  };

  const openCreate = (status: string) => {
    setEditingIssue(null);
    setCreateStatus(status);
    setDialogOpen(true);
  };

  const openEdit = (issue: Issue) => {
    setEditingIssue(issue);
    setDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex gap-6 h-full min-w-max pb-4">
        {STATUS_ORDER.map((s) => (
          <div key={s} className="w-80 h-full bg-card border border-border animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="flex gap-6 h-full min-w-max pb-4">
        {STATUS_ORDER.map((status) => {
          const statusIssues = issues?.filter((i) => i.status === status) ?? [];
          const isDragOver = dragOverStatus === status;

          return (
            <div
              key={status}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverStatus(status);
              }}
              onDragLeave={() => setDragOverStatus((s) => (s === status ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverStatus(null);
                const id = e.dataTransfer.getData("text/plain");
                const dragged = issues?.find((i) => i.id === id);
                if (dragged) moveIssue(dragged, status);
              }}
              className={`w-80 flex flex-col shrink-0 bg-card border-t-4 ${STATUS_ACCENTS[status]} border-x border-b transition-colors ${
                isDragOver ? "border-primary bg-primary/5" : "border-border"
              }`}
              data-testid={`column-${status}`}
            >
              <div className="p-3 border-b border-border bg-background flex items-center justify-between">
                <span className="font-bold text-sm tracking-wider">{STATUS_LABELS[status]}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5">{statusIssues.length}</span>
                  <button
                    onClick={() => openCreate(status)}
                    className="text-muted-foreground hover:text-primary"
                    title={`New issue in ${STATUS_LABELS[status]}`}
                    aria-label={`New issue in ${STATUS_LABELS[status]}`}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 p-3 flex flex-col gap-3 overflow-y-auto min-h-24">
                {statusIssues.map((issue) => (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    onClick={() => openEdit(issue)}
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", issue.id)}
                  />
                ))}
                {statusIssues.length === 0 && (
                  <button
                    onClick={() => openCreate(status)}
                    className="text-xs text-muted-foreground/60 border border-dashed border-border py-6 hover:border-primary hover:text-primary transition-colors uppercase tracking-widest"
                  >
                    + Add
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <IssueDialog
        projectId={projectId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        issue={editingIssue}
        defaultStatus={createStatus}
      />
    </>
  );
}
