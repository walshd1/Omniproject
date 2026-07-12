import { useGetProjectIssues, useUpdateIssue, type Issue } from "@workspace/api-client-react";
import { STATUS_ORDER, STATUS_LABELS, PRIORITY_LABELS } from "../constants";
import type { BoardColumn, Chip, EntityDescriptor, ViewRecord } from "./types";

/**
 * The ISSUE entity's view-engine descriptor — the mirror of the task descriptor. Issues render
 * through the exact same generic engine as tasks (board / list), proving the two are treated
 * identically: only the status vocabulary and data hooks differ. The board columns follow the
 * conventional issue workflow (backlog → cancelled), but any backend-specific status still gets its
 * own column via the engine's fallback.
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
    const { data = [], isLoading, error } = useGetProjectIssues(scope.projectId ?? "");
    return { records: data.map(toRecord), isLoading, error };
  },
  useMove: () => {
    const update = useUpdateIssue();
    return (record, status) => {
      const i = record.raw;
      if (i.status === status) return;
      update.mutate({ projectId: i.projectId, issueId: i.id, data: { status, ...(i.version != null ? { expectedVersion: i.version } : {}) } });
    };
  },
  usePriorityLabel: () => (p) => (p ? PRIORITY_LABELS[p] ?? p : ""),
};
