import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TaskItemsPanel } from "./TaskItemsPanel";
import { canSurfaceField, canStoreField, canSurfaceEntity } from "../lib/capabilities-fields";
import { effortProgress } from "../lib/effort";
import {
  useCreateIssue,
  useUpdateIssue,
  useDeleteIssue,
  useGetCapabilities,
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
  budget: "",
  actualCost: "",
  costCenter: "",
  currency: "",
  billable: false,
  estimateHours: "",
  loggedHours: "",
  remainingHours: "",
  storyPoints: "",
  healthStatus: "",
  riskLevel: "",
  impact: "",
  urgency: "",
  blocked: false,
  blockedReason: "",
  mitigation: "",
  defectCount: "",
};

export function IssueDialog({ projectId, open, onOpenChange, issue, defaultStatus }: IssueDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createIssue = useCreateIssue();
  const updateIssue = useUpdateIssue();
  const deleteIssue = useDeleteIssue();
  const isEdit = !!issue;
  const { data: caps } = useGetCapabilities();
  // Field gating: hide a field the backend can't surface; make it read-only when
  // it can surface but not store (a read-only source field).
  const showF = (k: string) => canSurfaceField(caps, k);
  const editF = (k: string) => canStoreField(caps, k);

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
        budget: issue.budget != null ? String(issue.budget) : "",
        actualCost: issue.actualCost != null ? String(issue.actualCost) : "",
        costCenter: issue.costCenter ?? "",
        currency: issue.currency ?? "",
        billable: !!issue.billable,
        estimateHours: issue.estimateHours != null ? String(issue.estimateHours) : "",
        loggedHours: issue.loggedHours != null ? String(issue.loggedHours) : "",
        remainingHours: issue.remainingHours != null ? String(issue.remainingHours) : "",
        storyPoints: issue.storyPoints != null ? String(issue.storyPoints) : "",
        healthStatus: issue.healthStatus ?? "",
        riskLevel: issue.riskLevel ?? "",
        impact: issue.impact ?? "",
        urgency: issue.urgency ?? "",
        blocked: !!issue.blocked,
        blockedReason: issue.blockedReason ?? "",
        mitigation: issue.mitigation ?? "",
        defectCount: issue.defectCount != null ? String(issue.defectCount) : "",
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

  const numOrNull = (v: string): number | null => {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n) ? n : null;
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
    // Per-task financials — only sent for fields the backend can store.
    ...(editF("budget") ? { budget: numOrNull(form.budget) } : {}),
    ...(editF("actualCost") ? { actualCost: numOrNull(form.actualCost) } : {}),
    ...(editF("billable") ? { billable: form.billable } : {}),
    ...(editF("costCenter") ? { costCenter: form.costCenter.trim() || null } : {}),
    ...(editF("currency") ? { currency: form.currency.trim() || null } : {}),
    // Per-task effort / time-tracking — only sent for storable fields.
    ...(editF("estimateHours") ? { estimateHours: numOrNull(form.estimateHours) } : {}),
    ...(editF("loggedHours") ? { loggedHours: numOrNull(form.loggedHours) } : {}),
    ...(editF("remainingHours") ? { remainingHours: numOrNull(form.remainingHours) } : {}),
    ...(editF("storyPoints") ? { storyPoints: numOrNull(form.storyPoints) } : {}),
    // Per-task risk & quality — only sent for storable fields.
    ...(editF("healthStatus") ? { healthStatus: form.healthStatus.trim() || null } : {}),
    ...(editF("riskLevel") ? { riskLevel: form.riskLevel.trim() || null } : {}),
    ...(editF("impact") ? { impact: form.impact.trim() || null } : {}),
    ...(editF("urgency") ? { urgency: form.urgency.trim() || null } : {}),
    ...(editF("blocked") ? { blocked: form.blocked } : {}),
    ...(editF("blockedReason") ? { blockedReason: form.blockedReason.trim() || null } : {}),
    ...(editF("mitigation") ? { mitigation: form.mitigation.trim() || null } : {}),
    ...(editF("defectCount") ? { defectCount: numOrNull(form.defectCount) } : {}),
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

  /** Copy/paste: re-send the current (possibly tweaked) fields as a NEW task —
   *  another slightly-different write through the broker, leaving the original. */
  const handleDuplicate = () => {
    if (!form.title.trim()) {
      setTitleError("An issue needs a title.");
      return;
    }
    setTitleError(null);
    const copy: IssueInput = { ...buildPayload(), title: `${form.title.trim()} (copy)` };
    createIssue.mutate(
      { projectId, data: copy },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "TASK DUPLICATED", description: copy.title });
          onOpenChange(false);
        },
        onError: () => toast({ title: "ERROR", description: "Failed to duplicate task.", variant: "destructive" }),
      },
    );
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

          {(showF("budget") || showF("actualCost") || showF("billable") || showF("costCenter") || showF("currency")) && (
            <div className="border-t border-border pt-4 space-y-3">
              <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Financials</h3>
              <div className="grid grid-cols-2 gap-4">
                {showF("budget") && (
                  <div className="space-y-1">
                    <label htmlFor="issue-budget" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Budget</label>
                    <Input id="issue-budget" type="number" inputMode="decimal" value={form.budget} disabled={!editF("budget")}
                      onChange={(e) => setForm((p) => ({ ...p, budget: e.target.value }))}
                      placeholder="0" className="rounded-none border-border font-mono disabled:opacity-60" />
                  </div>
                )}
                {showF("actualCost") && (
                  <div className="space-y-1">
                    <label htmlFor="issue-actual-cost" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Actual cost</label>
                    <Input id="issue-actual-cost" type="number" inputMode="decimal" value={form.actualCost} disabled={!editF("actualCost")}
                      onChange={(e) => setForm((p) => ({ ...p, actualCost: e.target.value }))}
                      placeholder="0" className="rounded-none border-border font-mono disabled:opacity-60" />
                  </div>
                )}
                {showF("currency") && (
                  <div className="space-y-1">
                    <label htmlFor="issue-currency" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Currency</label>
                    <Input id="issue-currency" value={form.currency} disabled={!editF("currency")}
                      onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value.toUpperCase() }))}
                      placeholder="GBP" maxLength={3} className="rounded-none border-border font-mono uppercase disabled:opacity-60" />
                  </div>
                )}
                {showF("costCenter") && (
                  <div className="space-y-1">
                    <label htmlFor="issue-cost-center" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Cost centre</label>
                    <Input id="issue-cost-center" value={form.costCenter} disabled={!editF("costCenter")}
                      onChange={(e) => setForm((p) => ({ ...p, costCenter: e.target.value }))}
                      placeholder="ENG-PLAT" className="rounded-none border-border font-mono disabled:opacity-60" />
                  </div>
                )}
              </div>
              {showF("billable") && (
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <input type="checkbox" aria-label="Billable" checked={form.billable} disabled={!editF("billable")}
                    onChange={(e) => setForm((p) => ({ ...p, billable: e.target.checked }))}
                    className="h-4 w-4 accent-primary disabled:opacity-60" />
                  Billable
                </label>
              )}
            </div>
          )}

          {(showF("estimateHours") || showF("loggedHours") || showF("remainingHours") || showF("storyPoints")) && (
            <div className="border-t border-border pt-4 space-y-3">
              <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Effort</h3>
              <div className="grid grid-cols-3 gap-4">
                {showF("estimateHours") && (
                  <div className="space-y-1">
                    <label htmlFor="issue-estimate-hours" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Estimate (h)</label>
                    <Input id="issue-estimate-hours" type="number" inputMode="decimal" value={form.estimateHours} disabled={!editF("estimateHours")}
                      onChange={(e) => setForm((p) => ({ ...p, estimateHours: e.target.value }))}
                      placeholder="0" className="rounded-none border-border font-mono disabled:opacity-60" />
                  </div>
                )}
                {showF("loggedHours") && (
                  <div className="space-y-1">
                    <label htmlFor="issue-logged-hours" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Logged (h)</label>
                    <Input id="issue-logged-hours" type="number" inputMode="decimal" value={form.loggedHours} disabled={!editF("loggedHours")}
                      onChange={(e) => setForm((p) => ({ ...p, loggedHours: e.target.value }))}
                      placeholder="0" className="rounded-none border-border font-mono disabled:opacity-60" />
                  </div>
                )}
                {showF("remainingHours") && (
                  <div className="space-y-1">
                    <label htmlFor="issue-remaining-hours" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Remaining (h)</label>
                    <Input id="issue-remaining-hours" type="number" inputMode="decimal" value={form.remainingHours} disabled={!editF("remainingHours")}
                      onChange={(e) => setForm((p) => ({ ...p, remainingHours: e.target.value }))}
                      placeholder="0" className="rounded-none border-border font-mono disabled:opacity-60" />
                  </div>
                )}
                {showF("storyPoints") && (
                  <div className="space-y-1">
                    <label htmlFor="issue-story-points" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Story points</label>
                    <Input id="issue-story-points" type="number" inputMode="decimal" value={form.storyPoints} disabled={!editF("storyPoints")}
                      onChange={(e) => setForm((p) => ({ ...p, storyPoints: e.target.value }))}
                      placeholder="0" className="rounded-none border-border font-mono disabled:opacity-60" />
                  </div>
                )}
              </div>
              {/* Derived estimate-vs-logged progress — shown only when both are surfaced and present. */}
              {showF("estimateHours") && showF("loggedHours") && (() => {
                const prog = effortProgress(Number(form.estimateHours), Number(form.loggedHours));
                if (prog.band === "unknown") return null;
                const tone = prog.band === "over" ? "bg-red-500" : prog.band === "near" ? "bg-amber-500" : "bg-primary";
                return (
                  <div className="space-y-1" data-testid="effort-progress">
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <span>Logged vs estimate</span>
                      <span className={prog.band === "over" ? "text-red-500" : ""}>
                        {prog.pct}%{prog.variance != null && prog.variance < 0 ? ` · ${-prog.variance}h over` : ""}
                      </span>
                    </div>
                    <div className="h-2 w-full bg-background border border-border">
                      <div className={`h-full ${tone}`} style={{ width: `${prog.barPct}%` }} />
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {(showF("healthStatus") || showF("riskLevel") || showF("impact") || showF("urgency") || showF("blocked") || showF("blockedReason") || showF("mitigation") || showF("defectCount")) && (
            <div className="border-t border-border pt-4 space-y-3">
              <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Risk &amp; quality</h3>
              <div className="grid grid-cols-2 gap-4">
                {showF("healthStatus") && (
                  <div className="space-y-1">
                    <label htmlFor="issue-health" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Health (RAG)</label>
                    <Input id="issue-health" value={form.healthStatus} disabled={!editF("healthStatus")}
                      onChange={(e) => setForm((p) => ({ ...p, healthStatus: e.target.value }))}
                      placeholder="green / amber / red" className="rounded-none border-border font-mono disabled:opacity-60" />
                  </div>
                )}
                {showF("riskLevel") && (
                  <div className="space-y-1">
                    <label htmlFor="issue-risk-level" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Risk level</label>
                    <Input id="issue-risk-level" value={form.riskLevel} disabled={!editF("riskLevel")}
                      onChange={(e) => setForm((p) => ({ ...p, riskLevel: e.target.value }))}
                      placeholder="low / medium / high" className="rounded-none border-border font-mono disabled:opacity-60" />
                  </div>
                )}
                {showF("impact") && (
                  <div className="space-y-1">
                    <label htmlFor="issue-impact" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Impact</label>
                    <Input id="issue-impact" value={form.impact} disabled={!editF("impact")}
                      onChange={(e) => setForm((p) => ({ ...p, impact: e.target.value }))}
                      placeholder="low / medium / high" className="rounded-none border-border font-mono disabled:opacity-60" />
                  </div>
                )}
                {showF("urgency") && (
                  <div className="space-y-1">
                    <label htmlFor="issue-urgency" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Urgency</label>
                    <Input id="issue-urgency" value={form.urgency} disabled={!editF("urgency")}
                      onChange={(e) => setForm((p) => ({ ...p, urgency: e.target.value }))}
                      placeholder="low / medium / high" className="rounded-none border-border font-mono disabled:opacity-60" />
                  </div>
                )}
                {showF("defectCount") && (
                  <div className="space-y-1">
                    <label htmlFor="issue-defect-count" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Defect count</label>
                    <Input id="issue-defect-count" type="number" inputMode="numeric" value={form.defectCount} disabled={!editF("defectCount")}
                      onChange={(e) => setForm((p) => ({ ...p, defectCount: e.target.value }))}
                      placeholder="0" className="rounded-none border-border font-mono disabled:opacity-60" />
                  </div>
                )}
              </div>
              {showF("blocked") && (
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <input type="checkbox" aria-label="Blocked" checked={form.blocked} disabled={!editF("blocked")}
                    onChange={(e) => setForm((p) => ({ ...p, blocked: e.target.checked }))}
                    className="h-4 w-4 accent-red-500 disabled:opacity-60" />
                  Blocked
                </label>
              )}
              {showF("blockedReason") && (
                <div className="space-y-1">
                  <label htmlFor="issue-blocked-reason" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Blocked reason</label>
                  <Input id="issue-blocked-reason" value={form.blockedReason} disabled={!editF("blockedReason")}
                    onChange={(e) => setForm((p) => ({ ...p, blockedReason: e.target.value }))}
                    placeholder="What's blocking it?" className="rounded-none border-border font-mono disabled:opacity-60" />
                </div>
              )}
              {showF("mitigation") && (
                <div className="space-y-1">
                  <label htmlFor="issue-mitigation" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Mitigation</label>
                  <textarea id="issue-mitigation" value={form.mitigation} disabled={!editF("mitigation")}
                    onChange={(e) => setForm((p) => ({ ...p, mitigation: e.target.value }))}
                    placeholder="Plan to reduce the risk…" rows={2}
                    className="w-full bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-primary resize-none disabled:opacity-60" />
                </div>
              )}
            </div>
          )}

          {/* Custom fields — the describe→reconcile path: any non-canonical field
              the backend exposed, carried through as gated read-only passthrough. */}
          {isEdit && issue && canSurfaceEntity(caps, "customField", false) && (caps?.customFields?.length ?? 0) > 0 && (() => {
            const values = (issue.customFields ?? {}) as Record<string, unknown>;
            const present = caps!.customFields!.filter((f) => values[f.key] != null);
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
          })()}

          {isEdit && issue && <TaskItemsPanel projectId={projectId} taskId={issue.id} />}

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
            {isEdit && (
              <Button
                type="button"
                variant="outline"
                onClick={handleDuplicate}
                disabled={createIssue.isPending}
                className="rounded-none border-border uppercase font-bold tracking-wider"
              >
                {createIssue.isPending ? "DUPLICATING…" : "Duplicate"}
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
