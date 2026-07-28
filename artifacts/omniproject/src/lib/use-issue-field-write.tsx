import {
  useUpdateIssue,
  getGetProjectIssuesQueryKey,
  type Issue,
  type IssueUpdate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useInvalidateIssueQueries } from "../hooks/use-invalidate-issue-queries";
import { useEditHistory } from "./edit-history";

/**
 * One place to write a single field on one issue — optimistic, concurrency-safe, with optional
 * **undo**. The grid and the side-panel both edit the same way, so the optimistic update + the
 * `expectedVersion` token + the 409/error handling live here once rather than being re-implemented
 * per surface. `write(..., { undoable: true })` additionally shows a "Saved · Undo" toast that, for
 * a short window, re-issues the inverse write against the latest version (so undo is itself
 * concurrency-safe — it never clobbers a newer change).
 */

export function buildFieldUpdate(field: string, value: unknown, version: number | null | undefined): IssueUpdate {
  return { [field]: value, ...(version != null ? { expectedVersion: version } : {}) } as IssueUpdate;
}

export interface FieldWriteOptions {
  /** Show a "Saved · Undo" toast that reverts this single field within the toast window. */
  undoable?: boolean;
  /** Human label for the undo toast (defaults to the field name). */
  label?: string;
}

export function useIssueFieldWrite() {
  const qc = useQueryClient();
  const updateIssue = useUpdateIssue();
  const invalidate = useInvalidateIssueQueries();
  const { toast } = useToast();

  /** The current cached copy of an issue (to read the freshest version for an undo write). */
  function current(projectId: string, issueId: string): Issue | undefined {
    return (qc.getQueryData<Issue[]>(getGetProjectIssuesQueryKey(projectId)) ?? []).find((i) => i.id === issueId);
  }

  /** Apply the write optimistically + through the broker, reverting the cache on error. */
  function run(projectId: string, issue: Issue, field: keyof IssueUpdate & string, value: unknown, onSaved?: () => void) {
    const key = getGetProjectIssuesQueryKey(projectId);
    const prevCache = qc.getQueryData<Issue[]>(key);
    qc.setQueryData<Issue[]>(key, (old) => (old ?? []).map((i) => (i.id === issue.id ? { ...i, [field]: value } : i)));
    updateIssue.mutate(
      { projectId, issueId: issue.id, data: buildFieldUpdate(field, value, issue.version) },
      {
        onSuccess: () => { invalidate(projectId); onSaved?.(); },
        onError: (err) => {
          // Roll back ONLY this issue's field (not the whole list) so a concurrent in-flight edit of
          // a different row isn't clobbered by a whole-list restore; the invalidate below refetches.
          const prevIssue = prevCache?.find((i) => i.id === issue.id) as Record<string, unknown> | undefined;
          if (prevIssue) qc.setQueryData<Issue[]>(key, (old) => (old ?? []).map((i) => (i.id === issue.id ? { ...i, [field]: prevIssue[field] } : i)));
          const conflict = (err as { status?: number }).status === 409;
          invalidate(projectId);
          toast({
            title: conflict ? "EDIT CONFLICT" : "ERROR",
            description: conflict ? "This item changed elsewhere — refreshed instead of overwriting." : "Couldn't save the change.",
            variant: "destructive",
          });
        },
      },
    );
  }

  /** Re-apply a field value WITHOUT recording it in the undo history — the inverse/forward step for
   *  undo & redo. Reads the freshest cached issue (so the write stays concurrency-safe) and skips a
   *  no-op when the field already holds the target value. */
  function apply(projectId: string, issueId: string, field: keyof IssueUpdate & string, value: unknown) {
    const cur = current(projectId, issueId);
    if (!cur) return;
    if (((cur as unknown as Record<string, unknown>)[field] ?? null) === (value ?? null)) return;
    run(projectId, cur, field, value);
  }

  /** Write `field = value` on `issue`; with `undoable`, offer a one-click revert. */
  function write(projectId: string, issue: Issue, field: keyof IssueUpdate & string, value: unknown, opts: FieldWriteOptions = {}) {
    const previous = (issue as unknown as Record<string, unknown>)[field] ?? null;
    // Record every value-changing edit on the shared undo/redo stack (the multi-step counterpart to the
    // one-shot toast). Guarded on a real change so no-op commits don't clutter history.
    if ((previous ?? null) !== (value ?? null)) {
      useEditHistory.getState().record({ projectId, issueId: issue.id, field, from: previous, to: value ?? null, label: opts.label ?? field });
    }
    run(projectId, issue, field, value, () => {
      if (!opts.undoable || previous === value) return;
      toast({
        title: "Saved",
        description: opts.label ?? `Updated ${field}`,
        action: (
          <ToastAction
            altText={`Undo change to ${field}`}
            onClick={() => run(projectId, current(projectId, issue.id) ?? issue, field, previous)}
          >
            Undo
          </ToastAction>
        ),
      });
    });
  }

  return { write, apply };
}
