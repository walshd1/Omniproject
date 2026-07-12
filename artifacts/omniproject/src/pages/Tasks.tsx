import { useMemo, useState } from "react";
import { useTasks, useTaskSummary, useCreateTask, useUpdateTask, PRIORITIES, type Task, type Priority } from "../lib/tasks";
import { TaskDetailDialog } from "../components/TaskDetailDialog";
import { TaskBoard } from "../components/board/TaskBoard";
import { Button } from "@/components/ui/button";

const STATUS_FILTERS = ["all", "next", "waiting", "scheduled", "someday", "done"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const CLOSED = new Set(["done", "dropped"]);

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
 * app's nomenclature where an issue/work-item is already a "Task". A summary strip, a GTD-status
 * filter, the list, and a quick-add. Degrades to an empty state when the backend models no tasks.
 */
export function Tasks() {
  const { data: tasks = [], isLoading, error } = useTasks();
  const { data: summary } = useTaskSummary();
  const create = useCreateTask();
  const update = useUpdateTask();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [priority, setPriority] = useState<Priority>("none");
  const [detail, setDetail] = useState<Task | null>(null);
  const [view, setView] = useState<"list" | "board">("list");

  const shown = useMemo(
    () => tasks.filter((t) => (filter === "all" ? true : t.status === filter)),
    [tasks, filter],
  );

  const add = () => {
    if (!title.trim()) return;
    create.mutate(
      { title: title.trim(), ...(context.trim() ? { context: context.trim() } : {}), ...(priority !== "none" ? { priority } : {}) },
      { onSuccess: () => { setTitle(""); setContext(""); setPriority("none"); } },
    );
  };
  const toggleDone = (t: Task) => update.mutate({ id: t.id, patch: { status: CLOSED.has(t.status) ? "next" : "done" } });

  return (
    <div className="h-full flex flex-col">
      <div className="px-8 py-4 border-b border-border bg-card shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-black uppercase tracking-tighter">Tasks</h1>
            <p className="text-xs text-muted-foreground mt-1">Actionable next-actions (GTD) — distinct from issues.</p>
          </div>
          <div className="inline-flex border border-border shrink-0" role="tablist" aria-label="View">
            {(["list", "board"] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs uppercase tracking-wider font-semibold border-r border-border last:border-r-0 ${view === v ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                {v === "board" ? "GTD Board" : "List"}
              </button>
            ))}
          </div>
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
            onChange={(e) => setPriority(e.target.value as (typeof PRIORITIES)[number])}
          >
            {PRIORITIES.map((p) => <option key={p} value={p}>{p === "none" ? "priority…" : p}</option>)}
          </select>
          <Button className="rounded-none" onClick={add} disabled={!title.trim() || create.isPending}>Add</Button>
        </div>

        {/* Status filter */}
        {view === "board" ? (
          <TaskBoard tasks={tasks} onOpen={setDetail} />
        ) : (
        <>
        <div className="inline-flex flex-wrap border border-border" role="tablist" aria-label="Filter by status">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={filter === s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 text-xs uppercase tracking-wider font-semibold border-r border-border last:border-r-0 ${filter === s ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* List */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="text-sm text-muted-foreground">Couldn't load next actions.</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="tasks-empty">No next actions{filter === "all" ? " yet — add one above." : ` with status “${filter}”.`}</p>
        ) : (
          <ul className="divide-y divide-border border border-border">
            {shown.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label={CLOSED.has(t.status) ? `Reopen ${t.title}` : `Complete ${t.title}`}
                  checked={CLOSED.has(t.status)}
                  onChange={() => toggleDone(t)}
                />
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => setDetail(t)} className={`text-sm text-left hover:underline ${CLOSED.has(t.status) ? "line-through text-muted-foreground" : ""}`}>{t.title}</button>
                  <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground mt-0.5">
                    <span className="uppercase tracking-wider">{t.status}</span>
                    {t.context && <span className="font-mono">{t.context}</span>}
                    {t.assignee && <span>· {t.assignee}</span>}
                    {t.dueDate && <span>· due {t.dueDate}</span>}
                    {t.waitingOn && <span>· waiting on {t.waitingOn}</span>}
                  </div>
                </div>
                {t.priority && t.priority !== "none" && (
                  <span className="text-[10px] uppercase tracking-widest border border-border px-1.5 py-0.5">{t.priority}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        </>
        )}
      </div>

      <TaskDetailDialog task={detail} open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }} />
    </div>
  );
}
