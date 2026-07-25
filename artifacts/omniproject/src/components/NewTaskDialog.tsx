import { useEffect, useState } from "react";
import {
  useCreateIssue,
  useListProjects,
  useListProjectMembers,
  getListProjectMembersQueryKey,
  type IssueInput,
} from "@workspace/api-client-react";
import { parseQuickAdd } from "../lib/quick-add";
import { splitEntryLines, isMultiLine, MAX_MULTI_ENTRY } from "../lib/multi-entry";
import { useInvalidateIssueQueries } from "../hooks/use-invalidate-issue-queries";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "../store/useStore";
import { useFormDialog } from "../hooks/use-form-dialog";
import { STATUS_ORDER, STATUS_LABELS, PRIORITY_ORDER, PRIORITY_LABELS } from "../lib/constants";

/**
 * Create a task. A task ALWAYS belongs to a project, so the dialog requires an
 * explicit project selection (defaulting to the active project) — you can't
 * create a free-floating task. Brokered via createIssue, as you.
 */
export function NewTaskDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const invalidateIssueQueries = useInvalidateIssueQueries();
  const { toast } = useToast();
  const create = useCreateIssue();
  const { data: projects } = useListProjects();
  const { activeProjectId } = useStore();

  const { form, setForm, reset, close: resetOnClose } = useFormDialog({ projectId: "", title: "", status: "todo", priority: "none", assignee: "" });
  // Multi-entry (auto-split): pending lines from a multi-line paste into the title, awaiting confirm.
  const [pending, setPending] = useState<string[] | null>(null);
  const [pendingCut, setPendingCut] = useState(0);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Default the project to the active one (or the first) whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setForm((p) => ({ ...p, projectId: p.projectId || activeProjectId || projects?.[0]?.id || "" }));
    }
  }, [open, activeProjectId, projects, setForm]);

  // Members of the selected project — only WRITE-access people can be assigned. Disabled while
  // projectId is blank (e.g. the brief moment the draft resets after a successful submit, just
  // before the dialog closes) so it never fires a request against a malformed empty-id URL.
  const { data: members } = useListProjectMembers(form.projectId || "", {
    query: { enabled: !!form.projectId, queryKey: getListProjectMembersQueryKey(form.projectId) },
  });
  const assignable = (Array.isArray(members) ? members : []).filter((m) => m.access === "write");

  const titleError = form.title.trim() ? "" : "Title is required";
  const projectError = form.projectId ? "" : "A task must belong to a project";
  const close = (o: boolean) => {
    resetOnClose(o);
    if (!o) { setPending(null); setPendingCut(0); }
    onOpenChange(o);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (titleError || projectError) return;
    const data: IssueInput = {
      title: form.title.trim(),
      status: form.status as NonNullable<IssueInput["status"]>,
      priority: form.priority as NonNullable<IssueInput["priority"]>,
      assignee: form.assignee || null,
    };
    create.mutate(
      { projectId: form.projectId, data },
      {
        onSuccess: () => {
          invalidateIssueQueries(form.projectId);
          toast({ title: "TASK CREATED", description: data.title });
          reset();
          onOpenChange(false);
        },
        onError: () => toast({ title: "ERROR", description: "Could not create the task.", variant: "destructive" }),
      },
    );
  };

  // Build one issue create body from a single pasted line. Reuses the task quick-add parser (#tag @context
  // !priority ^date); tags → labels, ^date → dueDate. The dialog's explicit priority, when set, overrides
  // the per-line parse; status + assignee from the dialog are shared across every created task. @context
  // has no issue field, so it's ignored here.
  const issueFromLine = (line: string, today: Date): IssueInput => {
    const parsed = parseQuickAdd(line, today);
    const prio = form.priority !== "none" ? form.priority : (parsed.priority ?? "none");
    return {
      title: parsed.title || line.trim(),
      status: form.status as NonNullable<IssueInput["status"]>,
      priority: prio as NonNullable<IssueInput["priority"]>,
      assignee: form.assignee || null,
      ...(parsed.tags.length ? { labels: parsed.tags } : {}),
      ...(parsed.dueDate ? { dueDate: parsed.dueDate } : {}),
    };
  };

  // Intercept a MULTI-LINE paste into the title box and offer the split; a single-line paste is untouched.
  const onTitlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData?.getData("text") ?? "";
    if (!isMultiLine(text)) return;
    e.preventDefault();
    const { lines, truncated } = splitEntryLines(text);
    setPending(lines);
    setPendingCut(truncated);
  };

  // Confirm the split: create one issue per line in the selected project, settling ALL (a bad line never
  // aborts the rest), invalidating once, then reporting partial success.
  const createMany = async () => {
    if (!pending || pending.length === 0 || projectError) return;
    setBulkBusy(true);
    const today = new Date();
    const results = await Promise.allSettled(
      pending.map((line) => create.mutateAsync({ projectId: form.projectId, data: issueFromLine(line, today) })),
    );
    setBulkBusy(false);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - ok;
    invalidateIssueQueries(form.projectId);
    if (ok > 0) {
      toast({ title: `${ok} TASK${ok === 1 ? "" : "S"} CREATED`, ...(failed ? { description: `${failed} could not be created`, variant: "destructive" as const } : {}) });
      reset();
      setPending(null);
      setPendingCut(0);
      onOpenChange(false);
    } else {
      toast({ title: "ERROR", description: "Could not create the tasks.", variant: "destructive" });
    }
  };

  // "Add as one" escape hatch: drop the paste back into the title box (joined) instead of splitting.
  const addAsOne = () => {
    if (pending) setForm((p) => ({ ...p, title: pending.join(" ") }));
    setPending(null);
    setPendingCut(0);
  };

  const noProjects = !projects || projects.length === 0;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="rounded-none border-border">
        <DialogHeader>
          <DialogTitle className="uppercase tracking-tighter">New Task</DialogTitle>
          <DialogDescription>A task always belongs to a project.</DialogDescription>
        </DialogHeader>

        {noProjects ? (
          <p className="py-6 text-sm text-muted-foreground">No projects yet — create a project first, then add tasks to it.</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Project</label>
              <Select value={form.projectId} onValueChange={(v) => setForm((p) => ({ ...p, projectId: v, assignee: "" }))}>
                <SelectTrigger aria-label="Project" className="rounded-none border-border h-11 font-mono">
                  <SelectValue placeholder="Select a project…" />
                </SelectTrigger>
                <SelectContent className="rounded-none border-border font-mono">
                  {projects!.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {projectError && <p role="alert" className="text-xs font-bold text-red-500">{projectError}</p>}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="nt-title" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Title</label>
              <Input id="nt-title" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                onPaste={onTitlePaste}
                aria-invalid={form.title.length > 0 && !!titleError ? true : undefined}
                className="rounded-none border-border font-mono h-11" placeholder="Wire the auth callback — or paste a list" />
              {form.title.length > 0 && titleError && <p role="alert" className="text-xs font-bold text-red-500">{titleError}</p>}
            </div>

            {/* Multi-entry / auto-split preview — after a multi-line paste, confirm to create one task per line. */}
            {pending && (
              <div role="region" aria-label="Multi-task preview" className="rounded-none border border-border bg-muted/30 p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold">{pending.length} task{pending.length === 1 ? "" : "s"} detected</span>
                  <span className="text-xs text-muted-foreground">— one per line, in this project</span>
                </div>
                {pendingCut > 0 && (
                  <p className="text-xs font-bold text-amber-600">Only the first {MAX_MULTI_ENTRY} lines will be added — {pendingCut} more were left out.</p>
                )}
                <ul className="max-h-40 overflow-auto divide-y divide-border border border-border text-sm bg-card">
                  {pending.map((line, i) => {
                    const p = parseQuickAdd(line, new Date());
                    return (
                      <li key={i} className="flex flex-wrap items-center gap-2 px-2 py-1">
                        <span className="tabular-nums text-xs text-muted-foreground w-6">{i + 1}.</span>
                        <span className="flex-1">{p.title || line}</span>
                        {p.priority && p.priority !== "none" && <span className="text-[10px] uppercase tracking-wide border border-border px-1">{p.priority}</span>}
                        {p.tags.map((t) => <span key={t} className="text-[10px] font-mono text-muted-foreground">#{t}</span>)}
                        {p.dueDate && <span className="text-[10px] font-mono text-muted-foreground">due {p.dueDate}</span>}
                      </li>
                    );
                  })}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" className="rounded-none uppercase font-bold tracking-wider text-xs" onClick={createMany} disabled={bulkBusy || !!projectError}>
                    {bulkBusy ? "Creating…" : `Create ${pending.length} task${pending.length === 1 ? "" : "s"}`}
                  </Button>
                  <Button type="button" variant="outline" className="rounded-none uppercase font-bold tracking-wider text-xs" onClick={addAsOne} disabled={bulkBusy}>Add as one</Button>
                  <Button type="button" variant="ghost" className="rounded-none uppercase font-bold tracking-wider text-xs" onClick={() => { setPending(null); setPendingCut(0); }} disabled={bulkBusy}>Cancel</Button>
                </div>
              </div>
            )}

            {assignable.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Assignee <span className="font-normal lowercase">(optional)</span></label>
                <Select value={form.assignee} onValueChange={(v) => setForm((p) => ({ ...p, assignee: v }))}>
                  <SelectTrigger aria-label="Assignee" className="rounded-none border-border h-11 font-mono">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent className="rounded-none border-border font-mono">
                    {assignable.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name ?? m.email ?? m.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">Only people with write access to the project can be assigned.</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Status</label>
                <Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v }))}>
                  <SelectTrigger aria-label="Status" className="rounded-none border-border h-11 font-mono"><SelectValue /></SelectTrigger>
                  <SelectContent className="rounded-none border-border font-mono">
                    {STATUS_ORDER.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s] ?? s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Priority</label>
                <Select value={form.priority} onValueChange={(v) => setForm((p) => ({ ...p, priority: v }))}>
                  <SelectTrigger aria-label="Priority" className="rounded-none border-border h-11 font-mono"><SelectValue /></SelectTrigger>
                  <SelectContent className="rounded-none border-border font-mono">
                    {PRIORITY_ORDER.map((s) => <SelectItem key={s} value={s}>{PRIORITY_LABELS[s] ?? s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)} className="rounded-none border-border uppercase font-bold tracking-wider text-xs">Cancel</Button>
              <Button type="submit" disabled={!!titleError || !!projectError || create.isPending}
                className="rounded-none uppercase font-bold tracking-wider text-xs">
                {create.isPending ? "Creating…" : "Create task"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
