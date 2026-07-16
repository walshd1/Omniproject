import { Router } from "express";
import { getSettings } from "../lib/settings";
import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { requireAnyRole, requireRole } from "../lib/rbac";
import { getBroker, contextFromReq, withBrokerErrors } from "../broker";
import type { IssueWrite } from "../broker/types";
import { guardProjectScope } from "../lib/project-scope";
import { FormDefError, validateSubmission, issueWriteFromSubmission } from "../lib/form-def";

/**
 * Intake / request FORMS. Two surfaces:
 *   - the form DEFINITIONS store (GET open, PUT gated to admin/PMO — authoring a form that writes into a
 *     project is a governance act, like screen-defs); and
 *   - the SUBMISSION endpoint, which validates a filled-in form and creates a work item through the broker
 *     (the SAME write path as the issue grid), scope-guarded so a submission can't target a project outside
 *     the caller's scope.
 *
 * This is the end-user "capture a request → it becomes work" surface every competitor ships and OmniProject
 * lacked. Nothing is stored here beyond the definitions — submissions land in the system of record via the
 * broker, keeping the stateless-overlay guarantee.
 */
const router = Router();

/** Submit a filled-in form → create an issue in the form's target project. */
router.post("/forms/:formId/submit", requireRole("contributor"), async (req, res) => {
  const formId = String((req.params as { formId?: unknown }).formId ?? "");
  const def = (getSettings().forms ?? []).find((f) => f.id === formId);
  if (!def || def.enabled === false) {
    res.status(404).json({ error: "Form not found" });
    return;
  }
  const targetProjectId = def.target.projectId;
  if (!targetProjectId) {
    res.status(400).json({ error: "This form isn't connected to a project yet." });
    return;
  }

  let issueWrite: Record<string, unknown>;
  try {
    const clean = validateSubmission(def, (req.body as { values?: unknown } | undefined)?.values);
    issueWrite = issueWriteFromSubmission(def, clean);
  } catch (err) {
    if (err instanceof FormDefError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  await withBrokerErrors(req, res, "form submission failed", async () => {
    if (!(await guardProjectScope(req, res, targetProjectId))) return;
    const issue = await getBroker().writeIssue(contextFromReq(req), "create", issueWrite as unknown as IssueWrite);
    res.status(201).json({ ok: true, issue });
  }, { projectId: def.target.projectId });
});

// The form definitions store — read open (the SPA renders forms), write gated to admin/PMO.
router.use(settingsCollectionRouter({
  path: "/forms",
  settingsKey: "forms",
  versionLabel: "forms updated",
  writeGuards: [requireAnyRole("admin", "pmo")],
}));

export default router;
