import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetProjectIssues,
  useUpdateIssue,
  getGetProjectIssuesQueryKey,
  type Issue,
} from "@workspace/api-client-react";
import { useInvalidateIssueQueries } from "../../hooks/use-invalidate-issue-queries";
import { Plus } from "lucide-react";
import {
  STATUS_ORDER,
  statusLabel,
  statusAccent,
} from "../../lib/constants";
import { PriorityDot } from "../StatusDot";
import { IssueDialog } from "../IssueDialog";
import { DataState } from "../DataState";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

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
      aria-roledescription="Draggable card. Press Enter to open and change status."
      title="Draggable card — drag to move, or press Enter to open and change status."
      className="bg-background border border-border p-3 hover:border-primary cursor-pointer group active:cursor-grabbing outline-none focus-visible:border-primary"
      data-testid={`issue-card-${issue.id}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <PriorityDot priority={issue.priority} title={issue.priority} />
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
            {issue.assignee[0]!.toUpperCase()}
          </div>
        )}
      </div>
    </div>
  );
}

export function AgileBoard({ projectId }: { projectId: string }) {
  const { data: issues, isLoading, isError, error, refetch } = useGetProjectIssues(projectId);
  const updateIssue = useUpdateIssue();
  const queryClient = useQueryClient();
  const invalidateIssueQueries = useInvalidateIssueQueries();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIssue, setEditingIssue] = useState<Issue | null>(null);
  const [createStatus, setCreateStatus] = useState<string>("backlog");
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);

  const invalidate = () => invalidateIssueQueries(projectId);

  const moveIssue = (issue: Issue, status: string, isUndo = false) => {
    if (issue.status === status) return;
    const fromStatus = issue.status;
    const key = getGetProjectIssuesQueryKey(projectId);
    // Optimistic: move the card immediately so the board responds instantly,
    // then reconcile (onSuccess) or roll back (onError). The server is still the
    // authority — an unauthorised/failed move reverts visibly.
    queryClient.setQueryData<Issue[]>(key, (old) =>
      (old ?? []).map((i) => (i.id === issue.id ? { ...i, status } : i)),
    );
    updateIssue.mutate(
      { projectId, issueId: issue.id, data: { status } },
      {
        onSuccess: () => {
          invalidate();
          toast({
            title: isUndo ? "MOVE UNDONE" : "ISSUE MOVED",
            description: `${issue.id.slice(0, 8)} → ${statusLabel(status)}`,
            // Offer the inverse move back to where the card came from. Re-issued
            // optimistically like any other move (and itself undoable).
            ...(isUndo
              ? {}
              : {
                  action: (
                    <ToastAction
                      altText={`Undo move back to ${statusLabel(fromStatus)}`}
                      onClick={() => moveIssue({ ...issue, status }, fromStatus, true)}
                    >
                      Undo
                    </ToastAction>
                  ),
                }),
          });
        },
        onError: () => {
          // Roll back ONLY the affected issue to its fromStatus, so a concurrent
          // in-flight move of a different card isn't clobbered by a whole-list restore.
          queryClient.setQueryData<Issue[]>(key, (old) =>
            (old ?? []).map((i) => (i.id === issue.id ? { ...i, status: fromStatus } : i)),
          );
          toast({ title: "ERROR", description: "Failed to move issue.", variant: "destructive" });
        },
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

  // Columns: the conventional order plus any backend-specific statuses actually
  // present in the data, so non-conventional statuses still get a column rather
  // than being silently dropped (OmniProject is backend-agnostic).
  const columns = useMemo(() => {
    const known = STATUS_ORDER as readonly string[];
    const extra = [...new Set((issues ?? []).map((i) => i.status).filter((s) => !known.includes(s)))];
    return [...STATUS_ORDER, ...extra];
  }, [issues]);

  if (isError) {
    return <DataState isError error={error} onRetry={() => refetch()}>{null}</DataState>;
  }

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
        {columns.map((status) => {
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
              className={`w-80 flex flex-col shrink-0 bg-card border-t-4 ${statusAccent(status)} border-x border-b transition-colors ${
                isDragOver ? "border-primary bg-primary/5" : "border-border"
              }`}
              data-testid={`column-${status}`}
            >
              <div className="p-3 border-b border-border bg-background flex items-center justify-between">
                <span className="font-bold text-sm tracking-wider">{statusLabel(status)}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5">{statusIssues.length}</span>
                  <button
                    onClick={() => openCreate(status)}
                    className="text-muted-foreground hover:text-primary"
                    title={`New issue in ${statusLabel(status)}`}
                    aria-label={`New issue in ${statusLabel(status)}`}
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
