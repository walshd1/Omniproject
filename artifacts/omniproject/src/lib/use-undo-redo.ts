import { useEditHistory } from "./edit-history";
import { useIssueFieldWrite } from "./use-issue-field-write";
import type { IssueUpdate } from "@workspace/api-client-react";

/**
 * Undo / redo over the shared issue-edit history. `undo` inverse-applies the most recent edit (restoring
 * its `from`), `redo` re-applies the next (its `to`) — both through the shared, concurrency-safe writer,
 * so an undo never clobbers a newer change. `canUndo`/`canRedo` reflect the two stacks reactively.
 */
export function useUndoRedo() {
  const { apply } = useIssueFieldWrite();
  const past = useEditHistory((s) => s.past);
  const future = useEditHistory((s) => s.future);

  const undo = () => {
    const entry = useEditHistory.getState().popUndo();
    if (entry) apply(entry.projectId, entry.issueId, entry.field as keyof IssueUpdate & string, entry.from);
  };
  const redo = () => {
    const entry = useEditHistory.getState().popRedo();
    if (entry) apply(entry.projectId, entry.issueId, entry.field as keyof IssueUpdate & string, entry.to);
  };

  return { undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}
