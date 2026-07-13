import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useInvalidateIssueQueries } from "../../hooks/use-invalidate-issue-queries";
import {
  useCreateIssue,
  useUpdateIssue,
  useDeleteIssue,
  type Issue,
  type IssueInput,
  type IssueUpdate,
} from "@workspace/api-client-react";

/**
 * Owns the three write flows behind the issue dialog — create/update (with 409 conflict handling),
 * duplicate, and delete (with a one-click "Undo" toast that re-creates the issue) — plus the toast +
 * query-invalidation orchestration around them. Extracted so IssueDialog stays presentational (mirrors
 * the existing useIssueForm split). Callers pass an already-built payload; title validation and
 * buildPayload stay a form concern in the component.
 */
export function useIssueMutations({
  projectId,
  issue,
  onClose,
}: {
  projectId: string;
  issue: Issue | null | undefined;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const invalidateIssueQueries = useInvalidateIssueQueries();
  const createIssue = useCreateIssue();
  const updateIssue = useUpdateIssue();
  const deleteIssue = useDeleteIssue();
  const invalidate = () => invalidateIssueQueries(projectId);

  /** Create (no issue) or update (existing issue, optimistic-concurrency + 409-safe) from a built payload. */
  const submit = (payload: IssueInput) => {
    if (issue) {
      // Optimistic concurrency: send the version we loaded so the gateway/backend rejects the write
      // with 409 if someone else changed it meanwhile.
      const update: IssueUpdate = { ...payload, ...(issue.version != null ? { expectedVersion: issue.version } : {}) };
      updateIssue.mutate(
        { projectId, issueId: issue.id, data: update },
        {
          onSuccess: () => {
            invalidate();
            toast({ title: "ISSUE UPDATED", description: issue.title });
            onClose();
          },
          onError: (err) => {
            if ((err as { status?: number }).status === 409) {
              invalidate();
              toast({
                title: "EDIT CONFLICT",
                description: "This issue was changed by someone else. Your view has been refreshed — re-apply your change.",
                variant: "destructive",
              });
              onClose();
              return;
            }
            toast({ title: "ERROR", description: "Failed to update issue.", variant: "destructive" });
          },
        },
      );
    } else {
      createIssue.mutate(
        { projectId, data: payload },
        {
          onSuccess: () => {
            invalidate();
            toast({ title: "ISSUE CREATED", description: payload.title });
            onClose();
          },
          onError: () => toast({ title: "ERROR", description: "Failed to create issue.", variant: "destructive" }),
        },
      );
    }
  };

  /** Copy/paste: re-send the (possibly tweaked) fields as a NEW task, leaving the original. */
  const duplicate = (copy: IssueInput) => {
    createIssue.mutate(
      { projectId, data: copy },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "TASK DUPLICATED", description: copy.title });
          onClose();
        },
        onError: () => toast({ title: "ERROR", description: "Failed to duplicate task.", variant: "destructive" }),
      },
    );
  };

  /** Delete the current issue, offering a best-effort "Undo" that re-creates it (with a fresh id). */
  const remove = () => {
    if (!issue) return;
    // Snapshot the issue's fields so an "Undo" can re-create it best-effort. The new issue gets a
    // fresh id (we can't resurrect the original), but the content is preserved.
    const restore: IssueInput = {
      title: issue.title,
      ...(issue.description != null ? { description: issue.description } : {}),
      status: issue.status as NonNullable<IssueInput["status"]>,
      priority: issue.priority as NonNullable<IssueInput["priority"]>,
      assignee: issue.assignee ?? null,
      labels: [...issue.labels],
      startDate: issue.startDate ?? null,
      dueDate: issue.dueDate ?? null,
    };
    deleteIssue.mutate(
      { projectId, issueId: issue.id },
      {
        onSuccess: () => {
          invalidate();
          toast({
            title: "ISSUE DELETED",
            description: issue.title,
            action: (
              <ToastAction
                altText={`Undo delete of ${issue.title}`}
                onClick={() =>
                  createIssue.mutate(
                    { projectId, data: restore },
                    {
                      onSuccess: () => {
                        invalidate();
                        toast({ title: "ISSUE RESTORED", description: restore.title });
                      },
                      onError: () =>
                        toast({ title: "ERROR", description: "Failed to restore issue.", variant: "destructive" }),
                    },
                  )
                }
              >
                Undo
              </ToastAction>
            ),
          });
          onClose();
        },
        onError: () => toast({ title: "ERROR", description: "Failed to delete issue.", variant: "destructive" }),
      },
    );
  };

  return {
    submit,
    duplicate,
    remove,
    /** True while a create/update (the submit button) is in flight. */
    pending: createIssue.isPending || updateIssue.isPending,
    /** True while a delete is in flight (the delete button). */
    deleting: deleteIssue.isPending,
    /** True while a create (the duplicate button also uses createIssue) is in flight. */
    duplicating: createIssue.isPending,
  };
}
