import { useUpdateTask, type Task } from "../../lib/tasks";
import { usePriorityLabels } from "../../lib/priority-labels";
import { GTD_COLUMNS } from "../../lib/view-engine/task-descriptor";
import { RecordBoard } from "../view-engine/RecordBoard";
import type { Chip, ViewRecord } from "../../lib/view-engine/types";

/**
 * A GTD board for tasks — a thin adapter over the generic {@link RecordBoard} view engine, pinned to
 * the classic Getting-Things-Done columns. Kept as a convenience wrapper; new surfaces should render
 * tasks through the view engine (EntityViews + taskDescriptor) so any view/preset is available.
 */
export { GTD_COLUMNS };

function toRecord(t: Task): ViewRecord<Task> {
  const chips: Chip[] = [];
  if (t.context) chips.push({ text: t.context, mono: true });
  if (t.assignee) chips.push({ text: t.assignee });
  if (t.dueDate) chips.push({ text: `due ${t.dueDate}` });
  if (t.waitingOn) chips.push({ text: `waiting on ${t.waitingOn}` });
  return { id: t.id, title: t.title, status: t.status, priority: t.priority ?? null, chips, raw: t };
}

export function TaskBoard({ tasks, onOpen }: { tasks: Task[]; onOpen: (t: Task) => void }) {
  const update = useUpdateTask();
  const { labelFor } = usePriorityLabels();
  return (
    <RecordBoard
      records={tasks.map(toRecord)}
      columns={GTD_COLUMNS}
      noun="task"
      labelForPriority={labelFor}
      onMove={(r, status) => { if (r.status !== status) update.mutate({ id: r.id, patch: { status } }); }}
      onOpen={(r) => onOpen(r.raw)}
    />
  );
}
