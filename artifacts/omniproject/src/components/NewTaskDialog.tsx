import { useEffect } from "react";
import {
  useCreateIssue,
  useListProjects,
  useListProjectMembers,
  type IssueInput,
} from "@workspace/api-client-react";
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

  // Default the project to the active one (or the first) whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setForm((p) => ({ ...p, projectId: p.projectId || activeProjectId || projects?.[0]?.id || "" }));
    }
  }, [open, activeProjectId, projects]);

  // Members of the selected project — only WRITE-access people can be assigned.
  const { data: members } = useListProjectMembers(form.projectId || "");
  const assignable = (members ?? []).filter((m) => m.access === "write");

  const titleError = form.title.trim() ? "" : "Title is required";
  const projectError = form.projectId ? "" : "A task must belong to a project";
  const close = (o: boolean) => {
    resetOnClose(o);
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
                aria-invalid={form.title.length > 0 && !!titleError ? true : undefined}
                className="rounded-none border-border font-mono h-11" placeholder="Wire the auth callback" />
              {form.title.length > 0 && titleError && <p role="alert" className="text-xs font-bold text-red-500">{titleError}</p>}
            </div>

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
