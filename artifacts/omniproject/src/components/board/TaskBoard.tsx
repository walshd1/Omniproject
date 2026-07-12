import { useMemo, useState } from "react";
import { useUpdateTask, type Task } from "../../lib/tasks";
import { usePriorityLabels } from "../../lib/priority-labels";

/**
 * A GTD board — the task analogue of the issue Kanban, but with the classic Getting-Things-Done
 * workflow as its columns (Next Actions · Waiting For · Scheduled · Someday/Maybe · Done). Drag a
 * card between columns to change its GTD state, or use the per-card selector (keyboard-accessible).
 * Any non-standard status the backend uses still gets its own column rather than being dropped.
 */
export const GTD_COLUMNS: { status: string; label: string }[] = [
  { status: "next", label: "Next Actions" },
  { status: "waiting", label: "Waiting For" },
  { status: "scheduled", label: "Scheduled" },
  { status: "someday", label: "Someday / Maybe" },
  { status: "done", label: "Done" },
];

export function TaskBoard({ tasks, onOpen }: { tasks: Task[]; onOpen: (t: Task) => void }) {
  const update = useUpdateTask();
  const { labelFor } = usePriorityLabels();
  const [dragId, setDragId] = useState<string | null>(null);

  const columns = useMemo(() => {
    const known = new Set(GTD_COLUMNS.map((c) => c.status));
    const extra = [...new Set(tasks.map((t) => t.status).filter((s) => s && !known.has(s)))];
    return [...GTD_COLUMNS, ...extra.map((s) => ({ status: s, label: s }))];
  }, [tasks]);

  const move = (task: Task, status: string) => {
    if (task.status !== status) update.mutate({ id: task.id, patch: { status } });
  };

  return (
    <div className="flex gap-4 h-full min-w-max pb-4" data-testid="task-board">
      {columns.map((col) => {
        const cards = tasks.filter((t) => t.status === col.status);
        return (
          <div
            key={col.status}
            className="w-72 flex flex-col bg-card border border-border"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { const t = tasks.find((x) => x.id === dragId); if (t) move(t, col.status); setDragId(null); }}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-xs font-black uppercase tracking-wider">{col.label}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground">{cards.length}</span>
            </div>
            <div className="flex-1 overflow-auto p-2 space-y-2" aria-label={col.label}>
              {cards.map((t) => (
                <div
                  key={t.id}
                  draggable
                  onDragStart={() => setDragId(t.id)}
                  className="border border-border bg-background px-2 py-2 space-y-1"
                >
                  <button type="button" onClick={() => onOpen(t)} className="text-sm text-left hover:underline block w-full">{t.title}</button>
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                    {t.context && <span className="font-mono">{t.context}</span>}
                    {t.assignee && <span>· {t.assignee}</span>}
                    {t.dueDate && <span>· due {t.dueDate}</span>}
                    {t.priority && t.priority !== "none" && <span className="uppercase border border-border px-1">{labelFor(t.priority)}</span>}
                  </div>
                  <label className="sr-only" htmlFor={`move-${t.id}`}>Move {t.title}</label>
                  <select
                    id={`move-${t.id}`}
                    className="w-full rounded-none border border-border bg-card px-1 py-0.5 text-[11px]"
                    value={t.status}
                    onChange={(e) => move(t, e.target.value)}
                  >
                    {columns.map((c) => <option key={c.status} value={c.status}>{c.label}</option>)}
                  </select>
                </div>
              ))}
              {cards.length === 0 && <p className="text-[11px] text-muted-foreground px-1 py-2">—</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
