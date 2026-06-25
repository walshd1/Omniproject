import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateIssue,
  useUpdateIssue,
  useDeleteIssue,
  getGetProjectIssuesQueryKey,
  getGetProjectSummaryQueryKey,
  getListProjectsQueryKey,
  getListActivityQueryKey,
  type Issue,
  type IssueInput,
  type IssueUpdate,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { STATUS_ORDER, PRIORITY_ORDER, STATUS_LABELS, PRIORITY_LABELS } from "../lib/constants";

interface IssueDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided the dialog edits an existing issue; otherwise it creates one. */
  issue?: Issue | null;
  /** Pre-select a status column when creating. */
  defaultStatus?: string;
}

const EMPTY_FORM = {
  title: "",
  description: "",
  status: "backlog",
  priority: "none",
  assignee: "",
  labels: "",
  startDate: "",
  dueDate: "",
};

export function IssueDialog({ projectId, open, onOpenChange, issue, defaultStatus }: IssueDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createIssue = useCreateIssue();
  const updateIssue = useUpdateIssue();
  const deleteIssue = useDeleteIssue();
  const isEdit = !!issue;

  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [titleError, setTitleError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitleError(null);
    if (issue) {
      setForm({
        title: issue.title,
        description: issue.description ?? "",
        status: issue.status,
        priority: issue.priority,
        assignee: issue.assignee ?? "",
        labels: issue.labels.join(", "),
        startDate: issue.startDate ?? "",
        dueDate: issue.dueDate ?? "",
      });
    } else {
      setForm({ ...EMPTY_FORM, status: defaultStatus ?? "backlog" });
    }
  }, [open, issue, defaultStatus]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetProjectIssuesQueryKey(projectId) });
    queryClient.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
    queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListActivityQueryKey() });
  };

  const buildPayload = (): IssueInput => ({
    title: form.title.trim(),
    description: form.description.trim() || undefined,
    status: form.status as IssueInput["status"],
    priority: form.priority as IssueInput["priority"],
    assignee: form.assignee.trim() || null,
    labels: form.labels
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean),
    startDate: form.startDate || null,
    dueDate: form.dueDate || null,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setTitleError("An issue needs a title.");
      return;
    }
    setTitleError(null);

    const payload = buildPayload();

    if (isEdit && issue) {
      // Optimistic concurrency: send the version we loaded so the gateway/backend
      // rejects the write with 409 if someone else changed it meanwhile.
      const update: IssueUpdate = { ...payload, expectedVersion: issue.version ?? undefined };
      updateIssue.mutate(
        { projectId, issueId: issue.id, data: update },
        {
          onSuccess: () => {
            invalidate();
            toast({ title: "ISSUE UPDATED", description: issue.title });
            onOpenChange(false);
          },
          onError: (err) => {
            if ((err as { status?: number }).status === 409) {
              invalidate();
              toast({
                title: "EDIT CONFLICT",
                description: "This issue was changed by someone else. Your view has been refreshed — re-apply your change.",
                variant: "destructive",
              });
              onOpenChange(false);
              return;
            }
            toast({ title: "ERROR", description: "Failed to update issue.", variant: "destructive" });
          },
        },
      );
    } else {
      createIssue.mutate(
        { projectId, data: payload },
        {
          onSuccess: () => {
            invalidate();
            toast({ title: "ISSUE CREATED", description: payload.title });
            onOpenChange(false);
          },
          onError: () => toast({ title: "ERROR", description: "Failed to create issue.", variant: "destructive" }),
        },
      );
    }
  };

  const handleDelete = () => {
    if (!issue) return;
    // Snapshot the issue's fields so an "Undo" can re-create it best-effort. The
    // new issue gets a fresh id (we can't resurrect the original), but the
    // content is preserved.
    const restore: IssueInput = {
      title: issue.title,
      description: issue.description ?? undefined,
      status: issue.status as IssueInput["status"],
      priority: issue.priority as IssueInput["priority"],
      assignee: issue.assignee ?? null,
      labels: [...issue.labels],
      startDate: issue.startDate ?? null,
      dueDate: issue.dueDate ?? null,
    };
    deleteIssue.mutate(
      { projectId, issueId: issue.id },
      {
        onSuccess: () => {
          invalidate();
          toast({
            title: "ISSUE DELETED",
            description: issue.title,
            action: (
              <ToastAction
                altText={`Undo delete of ${issue.title}`}
                onClick={() =>
                  createIssue.mutate(
                    { projectId, data: restore },
                    {
                      onSuccess: () => {
                        invalidate();
                        toast({ title: "ISSUE RESTORED", description: restore.title });
                      },
                      onError: () =>
                        toast({ title: "ERROR", description: "Failed to restore issue.", variant: "destructive" }),
                    },
                  )
                }
              >
                Undo
              </ToastAction>
            ),
          });
          onOpenChange(false);
        },
        onError: () => toast({ title: "ERROR", description: "Failed to delete issue.", variant: "destructive" }),
      },
    );
  };

  const pending = createIssue.isPending || updateIssue.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-none border-2 border-foreground bg-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-black uppercase tracking-tighter">
            {isEdit ? "EDIT ISSUE" : "NEW ISSUE"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {isEdit ? "Edit the fields of this issue and save your changes." : "Fill in the fields to create a new issue."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="issue-title" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Title <span className="text-red-500" aria-hidden="true">*</span>
            </label>
            <Input
              id="issue-title"
              autoFocus
              required
              aria-required="true"
              aria-invalid={titleError ? true : undefined}
              aria-describedby={titleError ? "issue-title-error" : undefined}
              value={form.title}
              onChange={(e) => {
                const value = e.target.value;
                setForm((p) => ({ ...p, title: value }));
                if (titleError && value.trim()) setTitleError(null);
              }}
              placeholder="What needs to be done?"
              className="rounded-none border-border font-mono aria-[invalid=true]:border-red-500"
            />
            {titleError && (
              <p id="issue-title-error" role="alert" className="text-xs font-bold text-red-500">
                {titleError}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="issue-description" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Description</label>
            <textarea
              id="issue-description"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Add detail…"
              rows={3}
              className="w-full bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-primary resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label htmlFor="issue-status" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Status</label>
              <Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v }))}>
                <SelectTrigger id="issue-status" aria-label="Status" className="rounded-none border-border font-mono uppercase text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-none border-border font-mono uppercase">
                  {STATUS_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label htmlFor="issue-priority" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Priority</label>
              <Select value={form.priority} onValueChange={(v) => setForm((p) => ({ ...p, priority: v }))}>
                <SelectTrigger id="issue-priority" aria-label="Priority" className="rounded-none border-border font-mono uppercase text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-none border-border font-mono uppercase">
                  {PRIORITY_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>{PRIORITY_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label htmlFor="issue-assignee" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Assignee</label>
              <Input
                id="issue-assignee"
                value={form.assignee}
                onChange={(e) => setForm((p) => ({ ...p, assignee: e.target.value }))}
                placeholder="username"
                className="rounded-none border-border font-mono"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="issue-labels" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Labels</label>
              <Input
                id="issue-labels"
                value={form.labels}
                onChange={(e) => setForm((p) => ({ ...p, labels: e.target.value }))}
                placeholder="infra, auth"
                className="rounded-none border-border font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label htmlFor="issue-start-date" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Start Date</label>
              <Input
                id="issue-start-date"
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
                className="rounded-none border-border font-mono"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="issue-due-date" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Due Date</label>
              <Input
                id="issue-due-date"
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
                className="rounded-none border-border font-mono"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {isEdit ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={deleteIssue.isPending}
                    className="rounded-none border-red-500/50 text-red-500 hover:bg-red-500 hover:text-background uppercase font-bold tracking-wider"
                  >
                    {deleteIssue.isPending ? "DELETING…" : "DELETE"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="rounded-none border-2 border-foreground bg-card">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="font-black uppercase tracking-tighter">Delete issue?</AlertDialogTitle>
                    <AlertDialogDescription>
                      “{issue?.title}” will be permanently deleted from the backend. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="rounded-none uppercase font-bold tracking-wider">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDelete}
                      className="rounded-none bg-red-500 text-background hover:bg-red-600 uppercase font-bold tracking-wider"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : <span />}
            <Button
              type="submit"
              disabled={pending}
              className="rounded-none border border-primary bg-primary text-primary-foreground hover:bg-primary/90 uppercase font-bold tracking-wider"
            >
              {pending ? "SAVING…" : isEdit ? "SAVE CHANGES" : "CREATE ISSUE"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
