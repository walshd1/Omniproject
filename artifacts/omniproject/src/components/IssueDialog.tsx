import { TaskItemsPanel } from "./TaskItemsPanel";
import { CommentsPanel } from "./issue-dialog/CommentsPanel";
import { useFeatures, featureEnabled } from "../lib/features";
import { canSurfaceEntity } from "../lib/capabilities-fields";
import { useIssueForm } from "./issue-dialog/use-issue-form";
import { useIssueMutations } from "./issue-dialog/use-issue-mutations";
import { FinancialsPanel } from "./issue-dialog/FinancialsPanel";
import { EffortPanel } from "./issue-dialog/EffortPanel";
import { RiskQualityPanel } from "./issue-dialog/RiskQualityPanel";
import {
  useGetCapabilities,
  type Capabilities,
  type Issue,
  type IssueInput,
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

/** Read-only passthrough of the non-canonical fields the backend exposed (the describe→reconcile
 *  path) — only the discovered fields that actually carry a value on this issue are shown. */
function BackendCustomFields({ issue, caps }: { issue: Issue; caps: Capabilities }) {
  const values = (issue.customFields ?? {}) as Record<string, unknown>;
  const present = (caps.customFields ?? []).filter((f) => values[f.key] != null);
  if (present.length === 0) return null;
  return (
    <div className="border-t border-border pt-4 space-y-3" data-testid="custom-fields">
      <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">
        Custom fields <span className="text-[10px] font-mono opacity-60">· from backend</span>
      </h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        {present.map((f) => (
          <div key={f.key} className="space-y-0.5">
            <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{f.label || f.key}</dt>
            <dd className="text-sm font-mono">{String(values[f.key])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function IssueDialog({ projectId, open, onOpenChange, issue, defaultStatus }: IssueDialogProps) {
  const isEdit = !!issue;
  const { data: caps } = useGetCapabilities();
  const { data: features } = useFeatures();
  const commentsEnabled = featureEnabled(features, "comments");
  // Field gating: hide a field the backend can't surface; make it read-only when
  // it can surface but not store (a read-only source field).
  const { form, setForm, buildPayload, titleError, setTitleError, showF, editF } = useIssueForm(
    issue,
    defaultStatus,
    open,
    caps,
  );
  // Create/update/duplicate/delete orchestration (toasts, invalidation, 409, undo) lives in the hook.
  const { submit, duplicate, remove, pending, deleting, duplicating } = useIssueMutations({
    projectId,
    issue,
    onClose: () => onOpenChange(false),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setTitleError("An issue needs a title.");
      return;
    }
    setTitleError(null);
    submit(buildPayload());
  };

  /** Copy/paste: re-send the current (possibly tweaked) fields as a NEW task, leaving the original. */
  const handleDuplicate = () => {
    if (!form.title.trim()) {
      setTitleError("An issue needs a title.");
      return;
    }
    setTitleError(null);
    const copy: IssueInput = { ...buildPayload(), title: `${form.title.trim()} (copy)` };
    duplicate(copy);
  };

  const handleDelete = () => remove();

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

          {showF("description") && (
          <div className="space-y-1">
            <label htmlFor="issue-description" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Description</label>
            <textarea
              id="issue-description"
              value={form.description}
              disabled={!editF("description")}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Add detail…"
              rows={3}
              className="w-full bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-primary resize-none disabled:opacity-60"
            />
          </div>
          )}

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

            {showF("priority") && (
            <div className="space-y-1">
              <label htmlFor="issue-priority" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Priority</label>
              <Select value={form.priority} disabled={!editF("priority")} onValueChange={(v) => setForm((p) => ({ ...p, priority: v }))}>
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
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {showF("assignee") && (
            <div className="space-y-1">
              <label htmlFor="issue-assignee" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Assignee</label>
              <Input
                id="issue-assignee"
                value={form.assignee}
                disabled={!editF("assignee")}
                onChange={(e) => setForm((p) => ({ ...p, assignee: e.target.value }))}
                placeholder="username"
                className="rounded-none border-border font-mono disabled:opacity-60"
              />
            </div>
            )}
            {showF("labels") && (
            <div className="space-y-1">
              <label htmlFor="issue-labels" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Labels</label>
              <Input
                id="issue-labels"
                value={form.labels}
                disabled={!editF("labels")}
                onChange={(e) => setForm((p) => ({ ...p, labels: e.target.value }))}
                placeholder="infra, auth"
                className="rounded-none border-border font-mono disabled:opacity-60"
              />
            </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {showF("startDate") && (
            <div className="space-y-1">
              <label htmlFor="issue-start-date" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Start Date</label>
              <Input
                id="issue-start-date"
                type="date"
                value={form.startDate}
                disabled={!editF("startDate")}
                onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
                className="rounded-none border-border font-mono disabled:opacity-60"
              />
            </div>
            )}
            {showF("dueDate") && (
            <div className="space-y-1">
              <label htmlFor="issue-due-date" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Due Date</label>
              <Input
                id="issue-due-date"
                type="date"
                value={form.dueDate}
                disabled={!editF("dueDate")}
                onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
                className="rounded-none border-border font-mono disabled:opacity-60"
              />
            </div>
            )}
          </div>

          <FinancialsPanel form={form} setForm={setForm} showF={showF} editF={editF} />

          <EffortPanel form={form} setForm={setForm} showF={showF} editF={editF} />

          <RiskQualityPanel form={form} setForm={setForm} showF={showF} editF={editF} />

          {/* Custom fields — the describe→reconcile path: any non-canonical field
              the backend exposed, carried through as gated read-only passthrough. */}
          {isEdit && issue && canSurfaceEntity(caps, "customField", false) && (caps?.customFields?.length ?? 0) > 0 && (
            <BackendCustomFields issue={issue} caps={caps!} />
          )}

          {isEdit && issue && <TaskItemsPanel projectId={projectId} taskId={issue.id} />}

          {isEdit && issue && commentsEnabled && <CommentsPanel roomId={`issue:${projectId}:${issue.id}`} />}

          <DialogFooter className="gap-2 sm:justify-between">
            {isEdit ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={deleting}
                    className="rounded-none border-red-500/50 text-red-500 hover:bg-red-500 hover:text-background uppercase font-bold tracking-wider"
                  >
                    {deleting ? "DELETING…" : "DELETE"}
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
            {isEdit && (
              <Button
                type="button"
                variant="outline"
                onClick={handleDuplicate}
                disabled={duplicating}
                className="rounded-none border-border uppercase font-bold tracking-wider"
              >
                {duplicating ? "DUPLICATING…" : "Duplicate"}
              </Button>
            )}
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
