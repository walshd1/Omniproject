import { useEffect, useState } from "react";
import { canSurfaceField, canStoreField } from "../../lib/capabilities-fields";
import { parseNumberOrNull } from "../../lib/validation";
import type { Capabilities, Issue, IssueInput } from "@workspace/api-client-react";

export const EMPTY_FORM = {
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

export type IssueForm = typeof EMPTY_FORM;
export type FieldPredicate = (k: string) => boolean;

/**
 * Owns the issue dialog's form: the draft state, the hydrate-on-open effect
 * (from the issue being edited or the empty defaults), title validation, and the
 * capability-gated payload builder. Field gating: `showF` hides a field the
 * backend can't surface; `editF` (store) decides whether it's sent on write.
 */
export function useIssueForm(
  issue: Issue | null | undefined,
  defaultStatus: string | undefined,
  open: boolean,
  caps: Capabilities | undefined,
) {
  const showF: FieldPredicate = (k) => canSurfaceField(caps, k);
  const editF: FieldPredicate = (k) => canStoreField(caps, k);

  const [form, setForm] = useState<IssueForm>({ ...EMPTY_FORM });
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

  const buildPayload = (): IssueInput => ({
    title: form.title.trim(),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    status: form.status as NonNullable<IssueInput["status"]>,
    priority: form.priority as NonNullable<IssueInput["priority"]>,
    assignee: form.assignee.trim() || null,
    labels: form.labels
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean),
    startDate: form.startDate || null,
    dueDate: form.dueDate || null,
    // Per-task financials — only sent for fields the backend can store.
    ...(editF("budget") ? { budget: parseNumberOrNull(form.budget) } : {}),
    ...(editF("actualCost") ? { actualCost: parseNumberOrNull(form.actualCost) } : {}),
    ...(editF("billable") ? { billable: form.billable } : {}),
    ...(editF("costCenter") ? { costCenter: form.costCenter.trim() || null } : {}),
    ...(editF("currency") ? { currency: form.currency.trim() || null } : {}),
    // Per-task effort / time-tracking — only sent for storable fields.
    ...(editF("estimateHours") ? { estimateHours: parseNumberOrNull(form.estimateHours) } : {}),
    ...(editF("loggedHours") ? { loggedHours: parseNumberOrNull(form.loggedHours) } : {}),
    ...(editF("remainingHours") ? { remainingHours: parseNumberOrNull(form.remainingHours) } : {}),
    ...(editF("storyPoints") ? { storyPoints: parseNumberOrNull(form.storyPoints) } : {}),
    // Per-task risk & quality — only sent for storable fields.
    ...(editF("healthStatus") ? { healthStatus: form.healthStatus.trim() || null } : {}),
    ...(editF("riskLevel") ? { riskLevel: form.riskLevel.trim() || null } : {}),
    ...(editF("impact") ? { impact: form.impact.trim() || null } : {}),
    ...(editF("urgency") ? { urgency: form.urgency.trim() || null } : {}),
    ...(editF("blocked") ? { blocked: form.blocked } : {}),
    ...(editF("blockedReason") ? { blockedReason: form.blockedReason.trim() || null } : {}),
    ...(editF("mitigation") ? { mitigation: form.mitigation.trim() || null } : {}),
    ...(editF("defectCount") ? { defectCount: parseNumberOrNull(form.defectCount) } : {}),
  });

  return { form, setForm, buildPayload, titleError, setTitleError, showF, editF };
}
