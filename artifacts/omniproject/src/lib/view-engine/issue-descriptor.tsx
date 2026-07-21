import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetProjectIssues, useUpdateIssue, getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { STATUS_ORDER, STATUS_LABELS } from "../constants";
import { useWorkVocabulary } from "../work-vocabulary";
import { useInvalidateIssueQueries } from "../../hooks/use-invalidate-issue-queries";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import type { BoardColumn, Chip, EntityDescriptor, ViewRecord } from "./types";

/**
 * The ISSUE entity's view-engine descriptor — the mirror of the task descriptor. Issues render
 * through the exact same generic engine as tasks (board / list), proving the two are treated
 * identically: only the status vocabulary and data hooks differ. The board columns, labels and
 * colours come LIVE from the org's scope-resolved work vocabulary (`useBoardColumns`/`useStatusLabel`),
 * so an org's status nomenclature, ordering, i18n labels and swatch colours drive the board with no
 * code change; any backend-specific status still gets its own column via the engine's fallback. The
 * static `presets`/`filterStatuses` below are only the compile-time fallback (used before the
 * vocabulary provider resolves).
 */

const ISSUE_COLUMNS: BoardColumn[] = STATUS_ORDER.map((s) => ({ status: s, label: STATUS_LABELS[s] ?? s }));

function toRecord(i: Issue): ViewRecord<Issue> {
  const chips: Chip[] = [{ text: i.id.slice(0, 8), mono: true }];
  if (i.assignee) chips.push({ text: i.assignee });
  if (i.dueDate) chips.push({ text: `due ${i.dueDate}` });
  for (const l of i.labels) chips.push({ text: l });
  return { id: i.id, title: i.title, status: i.status, priority: i.priority ?? null, chips, raw: i };
}

export const issueDescriptor: EntityDescriptor<Issue> = {
  entity: "issue",
  noun: "issue",
  presets: [{ id: "board", label: "Board", columns: ISSUE_COLUMNS }],
  fields: [
    { key: "status", label: "Status", get: (i) => i.status },
    { key: "priority", label: "Priority", get: (i) => i.priority },
    { key: "assignee", label: "Assignee", get: (i) => i.assignee },
    { key: "dueDate", label: "Due date", get: (i) => i.dueDate, isDate: true },
    { key: "startDate", label: "Start date", get: (i) => i.startDate, isDate: true },
    { key: "source", label: "Source", get: (i) => i.source },
  ],
  filterStatuses: [...STATUS_ORDER],
  closedStatuses: ["done", "cancelled"],
  doneStatus: "done",
  reopenStatus: "todo",
  useRecords: (scope) => {
    const { data, isLoading, error, refetch } = useGetProjectIssues(scope.projectId ?? "");
    // Stable identity (see task-descriptor): a fresh `.map` array each render defeats EntityViews' memo chain.
    const records = useMemo(() => (data ?? []).map(toRecord), [data]);
    const stableRefetch = useCallback(() => { void refetch(); }, [refetch]);
    return { records, isLoading, error, refetch: stableRefetch };
  },
  useMove: () => {
    const update = useUpdateIssue();
    const queryClient = useQueryClient();
    const invalidateIssueQueries = useInvalidateIssueQueries();
    const { toast } = useToast();
    const { statusLabel } = useWorkVocabulary();
    // The issue mover carries the full write semantics the legacy board used to own: an optimistic
    // cache move, an "undo" that re-issues the inverse move, and rollback + a distinct EDIT CONFLICT
    // toast on a 409. The generic board just calls this — the entity owns HOW its status changes.
    const move = (record: ViewRecord<Issue>, status: string, isUndo = false): void => {
      const i = record.raw;
      if (i.status === status) return;
      const fromStatus = i.status;
      const key = getGetProjectIssuesQueryKey(i.projectId);
      queryClient.setQueryData<Issue[]>(key, (old) => (old ?? []).map((x) => (x.id === i.id ? { ...x, status } : x)));
      update.mutate(
        { projectId: i.projectId, issueId: i.id, data: { status, ...(i.version != null ? { expectedVersion: i.version } : {}) } },
        {
          onSuccess: () => {
            invalidateIssueQueries(i.projectId);
            toast({
              title: isUndo ? "MOVE UNDONE" : "ISSUE MOVED",
              description: `${i.id.slice(0, 8)} → ${statusLabel(status)}`,
              ...(isUndo
                ? {}
                : {
                    action: (
                      <ToastAction altText={`Undo move back to ${statusLabel(fromStatus)}`} onClick={() => move({ ...record, raw: { ...i, status } }, fromStatus, true)}>
                        Undo
                      </ToastAction>
                    ),
                  }),
            });
          },
          onError: (err) => {
            queryClient.setQueryData<Issue[]>(key, (old) => (old ?? []).map((x) => (x.id === i.id ? { ...x, status: fromStatus } : x)));
            const conflict = (err as { status?: number }).status === 409;
            if (conflict) invalidateIssueQueries(i.projectId);
            toast({
              title: conflict ? "EDIT CONFLICT" : "ERROR",
              description: conflict ? "This card changed elsewhere — refreshed instead of overwriting." : "Failed to move issue.",
              variant: "destructive",
            });
          },
        },
      );
    };
    return (record, status) => move(record, status);
  },
  usePriorityLabel: () => {
    const { priorityLabel } = useWorkVocabulary();
    return (p) => (p ? priorityLabel(p) : "");
  },
  useBoardColumns: () => {
    const { statusOrder, statusLabel, statusColor } = useWorkVocabulary();
    return statusOrder.map((s) => ({ status: s, label: statusLabel(s), color: statusColor(s) }));
  },
  useStatusLabel: () => {
    const { statusLabel } = useWorkVocabulary();
    return (s) => (s ? statusLabel(s) : "");
  },
};
