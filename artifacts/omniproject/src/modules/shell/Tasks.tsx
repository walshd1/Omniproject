import { useTaskSummary, useCreateTask, PRIORITIES, type Task, type Priority } from "../../lib/tasks";
import { TaskDetailDialog } from "../../components/TaskDetailDialog";
import { EntityViews } from "../../components/view-engine/EntityViews";
import { taskDescriptor } from "../../lib/view-engine/task-descriptor";
import { useMemo, useState } from "react";
import { usePriorityLabels } from "../../lib/priority-labels";
import { parseQuickAdd } from "../../lib/quick-add";
import { parseTaskSearch } from "../../lib/task-search";
import { useTagPrefs } from "../../lib/use-tag-prefs";
import { tagDescendants } from "../../lib/tag-prefs";
import { taskAttention } from "../../lib/task-urgency";
import { filterRowsBoolean, type Row } from "@workspace/backend-catalogue";
import type { ViewRecord } from "../../lib/view-engine/types";
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
  const [search, setSearch] = useState("");
  const tagPrefs = useTagPrefs((s) => s.prefs);

  // Compile the search box into a predicate: parse the syntax, then for each record enrich its raw task
  // with the derived _urgency/_untouched fields and match the boolean filter tree + free text on the title.
  const recordFilter = useMemo(() => {
    const q = search.trim();
    if (!q) return undefined;
    // Hierarchy-aware tag search: a `#parent` also matches tasks tagged with any descendant (per-user tags).
    const { text, where } = parseTaskSearch(q, { expandTag: (tag) => tagDescendants(tag, tagPrefs) });
    const today = new Date();
    const needle = text.toLowerCase();
    return (rec: ViewRecord<Task>): boolean => {
      const t = rec.raw;
      const att = taskAttention(t, today);
      const row: Row = { ...(t as unknown as Row), _urgency: att.band, _untouched: att.untouched };
      if (filterRowsBoolean([row], where).length === 0) return false;
      return needle === "" || rec.title.toLowerCase().includes(needle);
    };
  }, [search, tagPrefs]);

  const add = () => {
    const raw = title.trim();
    if (!raw) return;
    // Parse inline syntax (#tag @context !priority ^date) out of the title; the explicit context/priority
    // controls, when set, OVERRIDE the parsed values so both ways of entering work together.
    const parsed = parseQuickAdd(raw, new Date());
    const ctx = context.trim() || parsed.context || "";
    const prio = priority !== "none" ? priority : (parsed.priority ?? "none");
    create.mutate(
      {
        title: parsed.title || raw,
        ...(ctx ? { context: ctx } : {}),
        ...(prio !== "none" ? { priority: prio as Priority } : {}),
        ...(parsed.tags.length ? { tags: parsed.tags } : {}),
        ...(parsed.dueDate ? { dueDate: parsed.dueDate } : {}),
      },
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
            placeholder="Add a next action…  (try #tag @context !p1 ^tomorrow)"
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

        {/* Search — free text + syntax (#tag @context is:overdue priority>=high -is:done). */}
        <input
          className="w-full rounded-none border border-border bg-card px-3 py-2 text-sm font-mono"
          placeholder="Search…  #tag @context is:overdue priority>=high -is:done"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search tasks"
        />

        {/* Views — list / GTD board / flow board, all driven by the generic engine. */}
        <EntityViews descriptor={taskDescriptor} onOpen={(r) => setDetail(r.raw)} {...(recordFilter ? { recordFilter } : {})} />
      </div>

      <TaskDetailDialog task={detail} open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }} />
    </div>
  );
}
