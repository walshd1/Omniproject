import { useTasks, useUpdateTask, type Task } from "../tasks";
import { usePriorityLabels } from "../priority-labels";
import type { BoardColumn, Chip, EntityDescriptor, ViewRecord } from "./types";

/**
 * The TASK entity's view-engine descriptor. Tasks render through the generic engine exactly like
 * issues do; the classic GTD workflow is exposed here as ONE board column-preset among others, not a
 * hard-wired mode — how a user or org wants to view their tasks is up to them.
 */

/** The classic Getting-Things-Done columns (the default board preset for tasks). */
export const GTD_COLUMNS: BoardColumn[] = [
  { status: "next", label: "Next Actions" },
  { status: "waiting", label: "Waiting For" },
  { status: "scheduled", label: "Scheduled" },
  { status: "someday", label: "Someday / Maybe" },
  { status: "done", label: "Done" },
];

/** A simple flow board — a plain to-do / done kanban for teams that don't use GTD nomenclature. */
export const FLOW_COLUMNS: BoardColumn[] = [
  { status: "next", label: "To do" },
  { status: "scheduled", label: "In progress" },
  { status: "done", label: "Done" },
];

function toRecord(t: Task): ViewRecord<Task> {
  const chips: Chip[] = [];
  if (t.context) chips.push({ text: t.context, mono: true });
  if (t.assignee) chips.push({ text: t.assignee });
  if (t.dueDate) chips.push({ text: `due ${t.dueDate}` });
  if (t.waitingOn) chips.push({ text: `waiting on ${t.waitingOn}` });
  return { id: t.id, title: t.title, status: t.status, priority: t.priority ?? null, chips, raw: t };
}

export const taskDescriptor: EntityDescriptor<Task> = {
  entity: "task",
  noun: "task",
  presets: [
    { id: "gtd", label: "GTD Board", columns: GTD_COLUMNS },
    { id: "flow", label: "Flow", columns: FLOW_COLUMNS },
  ],
  fields: [
    { key: "status", label: "Status", get: (t) => t.status },
    { key: "priority", label: "Priority", get: (t) => t.priority },
    { key: "context", label: "Context", get: (t) => t.context },
    { key: "assignee", label: "Assignee", get: (t) => t.assignee },
    { key: "dueDate", label: "Due date", get: (t) => t.dueDate, isDate: true },
    { key: "startDate", label: "Start date", get: (t) => t.startDate, isDate: true },
    { key: "energy", label: "Energy", get: (t) => t.energy },
    { key: "waitingOn", label: "Waiting on", get: (t) => t.waitingOn },
  ],
  filterStatuses: ["next", "waiting", "scheduled", "someday", "done"],
  closedStatuses: ["done", "dropped"],
  doneStatus: "done",
  reopenStatus: "next",
  useRecords: (scope) => {
    const { data = [], isLoading, error } = useTasks(scope.projectId);
    return { records: data.map(toRecord), isLoading, error };
  },
  useMove: () => {
    const update = useUpdateTask();
    return (record, status) => { if (record.status !== status) update.mutate({ id: record.id, patch: { status } }); };
  },
  usePriorityLabel: () => usePriorityLabels().labelFor,
};
