import { useState } from "react";
import { useTaskSummary, useCreateTask, PRIORITIES, type Task, type Priority } from "../../lib/tasks";
import { TaskDetailDialog } from "../../components/TaskDetailDialog";
import { EntityViews } from "../../components/view-engine/EntityViews";
import { taskDescriptor } from "../../lib/view-engine/task-descriptor";
import { usePriorityLabels } from "../../lib/priority-labels";
import { Button } from "@/components/ui/button";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-border bg-card px-3 py-2">
      <div className="text-2xl font-black tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}

/**
 * Tasks — the GTD TASK entity (`/api/tasks`), the "what can I do now" list. Named to avoid the
 * app's nomenclature where an issue/work-item is already a "Task". Rendered through the generic view
 * engine (list / GTD board / flow board — GTD is just one selectable view), with a summary strip and
 * a quick-add on top. Degrades to an empty state when the backend models no tasks.
 */
export function Tasks() {
  const { data: summary } = useTaskSummary();
  const { labelFor } = usePriorityLabels();
  const create = useCreateTask();
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [priority, setPriority] = useState<Priority>("none");
  const [detail, setDetail] = useState<Task | null>(null);

  const add = () => {
    if (!title.trim()) return;
    create.mutate(
      { title: title.trim(), ...(context.trim() ? { context: context.trim() } : {}), ...(priority !== "none" ? { priority } : {}) },
      { onSuccess: () => { setTitle(""); setContext(""); setPriority("none"); } },
    );
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-8 py-4 border-b border-border bg-card shrink-0">
        <div>
          <h1 className="text-xl font-black uppercase tracking-tighter">Tasks</h1>
          <p className="text-xs text-muted-foreground mt-1">Actionable next-actions — view them any way you like; GTD is just one of the views.</p>
        </div>
        {summary && (
          <div className="mt-3 grid grid-cols-3 sm:grid-cols-6 gap-2">
            <Stat label="Open" value={summary.open} />
            <Stat label="Actionable" value={summary.actionable} />
            <Stat label="Waiting" value={summary.byClass.waiting} />
            <Stat label="Overdue" value={summary.overdue} />
            <Stat label="Due soon" value={summary.dueSoon} />
            <Stat label="Unassigned" value={summary.unassigned} />
          </div>
        )}
      </div>

      <div className="flex-1 p-8 overflow-auto space-y-4">
        {/* Quick-add */}
        <div className="flex flex-wrap gap-2">
          <input
            className="flex-1 min-w-[12rem] rounded-none border border-border bg-card px-3 py-2 text-sm"
            placeholder="Add a next action…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          />
          <input
            className="w-40 rounded-none border border-border bg-card px-3 py-2 text-sm font-mono"
            placeholder="@context"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          />
          <select
            aria-label="Priority"
            className="w-32 rounded-none border border-border bg-card px-2 py-2 text-sm"
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority)}
          >
            {PRIORITIES.map((p) => <option key={p} value={p}>{p === "none" ? "priority…" : labelFor(p)}</option>)}
          </select>
          <Button className="rounded-none" onClick={add} disabled={!title.trim() || create.isPending}>Add</Button>
        </div>

        {/* Views — list / GTD board / flow board, all driven by the generic engine. */}
        <EntityViews descriptor={taskDescriptor} onOpen={(r) => setDetail(r.raw)} />
      </div>

      <TaskDetailDialog task={detail} open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }} />
    </div>
  );
}
