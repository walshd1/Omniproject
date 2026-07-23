import { useTaskSummary, useCreateTask, useCreateTasksBulk, PRIORITIES, type Task, type Priority } from "../../lib/tasks";
import { TaskDetailDialog } from "../../components/TaskDetailDialog";
import { EntityViews } from "../../components/view-engine/EntityViews";
import { taskDescriptor } from "../../lib/view-engine/task-descriptor";
import { useMemo, useState } from "react";
import { usePriorityLabels } from "../../lib/priority-labels";
import { parseQuickAdd } from "../../lib/quick-add";
import { splitEntryLines, isMultiLine, MAX_MULTI_ENTRY } from "../../lib/multi-entry";
import { useToast } from "@/hooks/use-toast";
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
  const bulk = useCreateTasksBulk();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [priority, setPriority] = useState<Priority>("none");
  const [detail, setDetail] = useState<Task | null>(null);
  const [search, setSearch] = useState("");
  // Multi-entry (auto-split): the pending lines from a multi-line paste, awaiting confirm. null = no
  // pending split. `pendingCut` is how many lines the MAX_MULTI_ENTRY cap dropped, if any.
  const [pending, setPending] = useState<string[] | null>(null);
  const [pendingCut, setPendingCut] = useState(0);
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

  // Build one create body from a single line: parse inline syntax (#tag @context !priority ^date), then
  // let the explicit context/priority controls, when set, OVERRIDE the parsed values — so both ways of
  // entering work together. Shared by the single add and the multi-line/auto-split path (one per line).
  const bodyFromLine = (line: string, today: Date): Partial<Task> => {
    const parsed = parseQuickAdd(line, today);
    const ctx = context.trim() || parsed.context || "";
    const prio = priority !== "none" ? priority : (parsed.priority ?? "none");
    return {
      title: parsed.title || line.trim(),
      ...(ctx ? { context: ctx } : {}),
      ...(prio !== "none" ? { priority: prio as Priority } : {}),
      ...(parsed.tags.length ? { tags: parsed.tags } : {}),
      ...(parsed.dueDate ? { dueDate: parsed.dueDate } : {}),
    };
  };

  const resetEntry = () => { setTitle(""); setContext(""); setPriority("none"); setPending(null); setPendingCut(0); };

  const add = () => {
    const raw = title.trim();
    if (!raw) return;
    create.mutate(bodyFromLine(raw, new Date()), { onSuccess: resetEntry });
  };

  // A multi-line paste is intercepted (below) and parked in `pending`; here we fan out one create per
  // line, reusing the SAME per-line builder so inline sigils are honoured on every line.
  const addMany = () => {
    if (!pending || pending.length === 0) return;
    const today = new Date();
    bulk.mutate(pending.map((line) => bodyFromLine(line, today)), {
      onSuccess: (r) => {
        toast({
          title: `Added ${r.created.length} task${r.created.length === 1 ? "" : "s"}`,
          ...(r.failed ? { description: `${r.failed} could not be created`, variant: "destructive" as const } : {}),
        });
        resetEntry();
      },
    });
  };

  // "Add as one" escape hatch: treat the whole paste as a single task instead of splitting — drop it back
  // into the title box (joined) for the user to review/submit normally.
  const addAsOne = () => {
    if (pending) setTitle(pending.join(" "));
    setPending(null);
    setPendingCut(0);
  };

  // Intercept a MULTI-LINE paste into the title box and offer the split; a single-line paste is left to
  // the browser's default (normal typing/paste is untouched).
  const onTitlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData?.getData("text") ?? "";
    if (!isMultiLine(text)) return;
    e.preventDefault();
    const { lines, truncated } = splitEntryLines(text);
    setPending(lines);
    setPendingCut(truncated);
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
            placeholder="Add a next action…  (try #tag @context !p1 ^tomorrow — or paste a list)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            onPaste={onTitlePaste}
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

        {/* Multi-entry / auto-split preview — appears after a multi-line paste; confirm to create one task per line. */}
        {pending && (
          <div role="region" aria-label="Multi-task preview" className="rounded-none border border-border bg-card p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold">{pending.length} task{pending.length === 1 ? "" : "s"} detected</span>
              <span className="text-xs text-muted-foreground">— one per line from your paste</span>
              <div className="ml-auto flex gap-2">
                <Button className="rounded-none" onClick={addMany} disabled={bulk.isPending}>
                  {bulk.isPending ? "Adding…" : `Add ${pending.length} task${pending.length === 1 ? "" : "s"}`}
                </Button>
                <Button variant="outline" className="rounded-none" onClick={addAsOne} disabled={bulk.isPending}>Add as one</Button>
                <Button variant="ghost" className="rounded-none" onClick={() => { setPending(null); setPendingCut(0); }} disabled={bulk.isPending}>Cancel</Button>
              </div>
            </div>
            {pendingCut > 0 && (
              <p className="text-xs font-bold text-amber-600">Only the first {MAX_MULTI_ENTRY} lines will be added — {pendingCut} more were left out.</p>
            )}
            <ul className="max-h-48 overflow-auto divide-y divide-border border border-border text-sm">
              {pending.map((line, i) => {
                const p = parseQuickAdd(line, new Date());
                return (
                  <li key={i} className="flex flex-wrap items-center gap-2 px-2 py-1">
                    <span className="tabular-nums text-xs text-muted-foreground w-6">{i + 1}.</span>
                    <span className="flex-1">{p.title || line}</span>
                    {p.priority && p.priority !== "none" && <span className="text-[10px] uppercase tracking-wide border border-border px-1">{labelFor(p.priority as Priority)}</span>}
                    {p.context && <span className="text-[10px] font-mono text-muted-foreground">@{p.context}</span>}
                    {p.tags.map((t) => <span key={t} className="text-[10px] font-mono text-muted-foreground">#{t}</span>)}
                    {p.dueDate && <span className="text-[10px] font-mono text-muted-foreground">due {p.dueDate}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

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
