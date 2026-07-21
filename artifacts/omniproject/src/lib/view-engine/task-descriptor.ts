import { useTasks, useUpdateTask, type Task } from "../tasks";
import { usePriorityLabels } from "../priority-labels";
import { taskAttention, type UrgencyBand } from "../task-urgency";
import type { BoardColumn, Chip, ChipTone, EntityDescriptor, ViewRecord } from "./types";

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

/** Due-date chip tone + label by urgency band — overdue reads red, due-soon/today amber. */
const BAND_TONE: Partial<Record<UrgencyBand, ChipTone>> = { overdue: "overdue", "due-today": "warn", "due-soon": "warn" };
const DAY_LABEL = (n: number | null): string =>
  n === null ? "" : n < 0 ? `${-n}d overdue` : n === 0 ? "due today" : n === 1 ? "due tomorrow" : `due in ${n}d`;

function toRecord(t: Task, today: Date): ViewRecord<Task> {
  const chips: Chip[] = [];
  if (t.context) chips.push({ text: t.context, mono: true });
  if (t.assignee) chips.push({ text: t.assignee });
  if (t.dueDate) {
    // Colour the due-date chip by urgency (from the shared pure rule), and label it relative to today.
    const att = taskAttention(t, today);
    const tone = BAND_TONE[att.band];
    chips.push({ text: DAY_LABEL(att.daysUntilDue) || `due ${t.dueDate}`, ...(tone ? { tone } : {}) });
  }
  if (t.waitingOn) chips.push({ text: `waiting on ${t.waitingOn}` });
  // Flag an open task that's gone stale (untouched past the window).
  if (taskAttention(t, today).untouched) chips.push({ text: "untouched", tone: "muted" });
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
    const today = new Date(); // browser-edge reference; the urgency maths itself is pure (see task-urgency)
    return { records: data.map((t) => toRecord(t, today)), isLoading, error };
  },
  useMove: () => {
    const update = useUpdateTask();
    return (record, status) => { if (record.status !== status) update.mutate({ id: record.id, patch: { status } }); };
  },
  usePriorityLabel: () => usePriorityLabels().labelFor,
  // Tasks carry a subtask link (parentTaskId) → the list view renders a fold/unfold subtask tree.
  parentOf: (r) => r.raw.parentTaskId ?? null,
  treeStorageKey: "task-tree-fold",
};
