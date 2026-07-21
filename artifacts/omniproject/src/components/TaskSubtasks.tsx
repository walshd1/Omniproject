import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useTasks, useCreateTask, useUpdateTask, type Task } from "../lib/tasks";
import { descendantIds } from "../lib/task-tree";

/**
 * TaskSubtasks — the subtask CREATE + re-parent affordance on the task detail. The list view already renders
 * the subtask tree from `parentTaskId`; this is the missing front door for BUILDING that hierarchy:
 *   - lists this task's existing children (complete / open);
 *   - "Add subtask" creates a new task already linked to this parent (same project);
 *   - "Move under…" re-parents THIS task, with its own subtree excluded from the candidates (no cycles).
 */
export function TaskSubtasks({ task, onOpen }: { task: Task; onOpen?: (t: Task) => void }) {
  const { toast } = useToast();
  // Scope the task universe to this task's project (personal tasks: the whole in-scope list).
  const { data: all = [] } = useTasks(task.projectId ?? undefined);
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const [title, setTitle] = useState("");

  const children = all.filter((t) => t.parentTaskId === task.id);
  // A task can't move under itself or any of its own descendants.
  const blocked = descendantIds(all, task.id);
  blocked.add(task.id);
  const parentCandidates = all.filter((t) => !blocked.has(t.id));

  const addSubtask = () => {
    const t = title.trim();
    if (!t) return;
    createTask.mutate(
      { title: t, status: "next", parentTaskId: task.id, ...(task.projectId ? { projectId: task.projectId } : {}) },
      {
        onSuccess: () => setTitle(""),
        onError: (e) => toast({ title: "Couldn't add subtask", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
      },
    );
  };

  return (
    <div data-testid="task-subtasks">
      <h3 className="text-xs font-bold uppercase tracking-widest mb-2">Subtasks</h3>

      <ul className="space-y-1">
        {children.length === 0 && <li className="text-xs text-muted-foreground">No subtasks yet.</li>}
        {children.map((c) => {
          const done = c.status === "done" || c.status === "dropped";
          return (
            <li key={c.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={done ? `Reopen ${c.title}` : `Complete ${c.title}`}
                checked={done}
                onChange={() => updateTask.mutate({ id: c.id, patch: { status: done ? "next" : "done" } })}
              />
              <button type="button" onClick={() => onOpen?.(c)} className={`text-left hover:underline ${done ? "line-through text-muted-foreground" : ""}`}>{c.title}</button>
            </li>
          );
        })}
      </ul>

      <div className="mt-2 flex gap-2">
        <input
          className="flex-1 rounded-none border border-border bg-card px-3 py-2 text-sm"
          placeholder="Add a subtask…"
          aria-label="New subtask title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addSubtask(); }}
        />
        <Button className="rounded-none" onClick={addSubtask} disabled={!title.trim() || createTask.isPending}>Add</Button>
      </div>

      {/* Re-parent THIS task (the "indent under…" affordance). */}
      <label className="mt-2 flex items-center gap-2 text-xs">
        <span className="uppercase tracking-widest text-[10px] text-muted-foreground">Move under</span>
        <select
          aria-label="Parent task"
          className="rounded-none border border-border bg-card px-2 py-1 text-[11px]"
          value={task.parentTaskId ?? ""}
          onChange={(e) => updateTask.mutate({ id: task.id, patch: { parentTaskId: e.target.value || null } })}
        >
          <option value="">— top level —</option>
          {parentCandidates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      </label>
    </div>
  );
}
