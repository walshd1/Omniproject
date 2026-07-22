import { Router } from "express";
import { getSettings, SettingsValidationError } from "../lib/settings";
import { captureVersion } from "../lib/config-store";
import { applySettingsGuarded } from "../lib/settings-guard";
import { requireRole, roleForReq } from "../lib/rbac";
import { getBroker, contextFromReq, withBrokerErrors } from "../broker";
import { actorForAudit } from "../lib/audit";
import type { IssueWrite } from "../broker/types";
import { guardProjectScope } from "../lib/project-scope";
import { evaluateRuleset } from "../lib/ruleset";
import { resolveCapabilities, type Capabilities } from "../lib/capabilities";
import { FormDefError, formContainerErrors, validateSubmission, issueWriteFromSubmission, filterIssueWriteToWritable } from "../lib/form-def";
import { findFormDef, resolveFormDefs } from "../lib/form-store";

/** The set of issue fields the connected backend ADVERTISES as storable (`FieldSupport.store`). A form may
 *  only write these — the same capability plane that gates the interactive grid's editable fields. */
function writableIssueFields(caps: Capabilities): Set<string> {
  return new Set(Object.entries(caps.fields).filter(([, s]) => s.store).map(([k]) => k));
}

/**
 * Intake / request FORMS. Two surfaces:
 *   - the SUBMISSION endpoint, which validates a filled-in form and creates a work item through the broker
 *     (the SAME write path as the issue grid), scope-guarded so a submission can't target a project outside
 *     the caller's scope; and
 *   - the LEGACY definitions slice (`GET`/`PUT /forms`), now READ-ONLY save-wise: form defs are ARTIFACTS
 *     authored through the importer (`POST`/`PUT /api/defs`, kind `form`), and the submission route reads them
 *     from the def store via `findFormDef`. The old settings writer survives only to DRAIN to `[]` (the one-shot
 *     migration), mirroring the dashboards convergence — so the parallel writer can never re-open as a bypass.
 *     The form→writable-field capability gate now rides the importer write path (`lib/def-write-hooks`).
 *
 * Nothing is stored here beyond the (migrating) definitions — submissions land in the system of record via the
 * broker, keeping the stateless-overlay guarantee.
 */
const router = Router();

/** Submit a filled-in form → create an issue in the form's target project. */
router.post("/forms/:formId/submit", requireRole("contributor"), async (req, res) => {
  const formId = String((req.params as { formId?: unknown }).formId ?? "");
  const def = findFormDef(req, formId);
  if (!def || def.enabled === false) {
    res.status(404).json({ error: "Form not found" });
    return;
  }
  const targetProjectId = def.target.projectId;
  if (!targetProjectId) {
    res.status(400).json({ error: "This form isn't connected to a project yet." });
    return;
  }

  // Validate the RESOLVED def through the shared engine floors at the point of use — so submission doesn't
  // trust an authoring-time validator and a def drifted by a scope override can't mint a malformed issue
  // (e.g. a title-less form). Single source of truth with the importer's composed-whole check.
  const defErrors = formContainerErrors(def);
  if (defErrors.length) {
    res.status(409).json({ error: `This form's definition is invalid: ${defErrors.join("; ")}` });
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

  // Same business ruleset the interactive issue grid runs (read-only / require-description / … ). A form
  // submission is just another create_issue write, so it must obey the deployment's rules, not bypass them.
  const verdict = evaluateRuleset({ action: "create_issue", write: true, role: roleForReq(req), projectId: targetProjectId, payload: issueWrite });
  if (!verdict.allow) {
    res.status(422).json({ error: verdict.blocked!.message, rule: verdict.blocked!.id });
    return;
  }

  await withBrokerErrors(req, res, "form submission failed", async () => {
    if (!(await guardProjectScope(req, res, targetProjectId))) return;
    if (verdict.warnings.length) res.setHeader("X-OmniProject-Rule-Warnings", verdict.warnings.map((w) => w.id).join(","));
    // Defence in depth: only write fields the backend still advertises as storable (it may have changed
    // since the form was authored). Never surface an unsupported field into the write.
    const writable = writableIssueFields(await resolveCapabilities(req));
    const { issue: writeInput } = filterIssueWriteToWritable(issueWrite, writable);
    const issue = await getBroker().writeIssue(contextFromReq(req), "create", writeInput as unknown as IssueWrite);
    res.status(201).json({ ok: true, issue });
  }, { projectId: def.target.projectId });
});

// The LEGACY form-definitions slice (roadmap X.10 forms convergence). Forms are now DEFINITIONS authored through
// the importer (`POST`/`PUT /api/defs`, kind `form`); this survives READ-ONLY, plus one permitted write:
// draining the slice to `[]` (the one-time migration in the forms admin). GET stays so the migration can read
// the old list; a non-empty write is a retired bypass → 410 Gone, pointing at the importer.
router.get("/forms", (_req, res) => {
  res.json({ forms: getSettings().forms ?? [] });
});

// GET /api/forms/resolved — the RESOLVED submittable set (legacy settings bridge + org/project/user def-store
// forms, def store winning). The renderer reads THIS (not the legacy slice), so a migrated form shows up and
// an un-migrated one still does until the drain. Read-open, same as the legacy slice.
router.get("/forms/resolved", (req, res) => {
  res.json({ forms: resolveFormDefs(req) });
});

router.put("/forms", requireRole("pmo"), async (req, res) => {
  const value = (req.body as Record<string, unknown> | undefined)?.["forms"];
  if (!Array.isArray(value) || value.length > 0) {
    res.status(410).json({
      error: "Forms are now definitions — author them through the importer (POST /api/defs, kind \"form\"). The legacy settings store is read-only and accepts only an empty array to complete migration.",
    });
    return;
  }
  try {
    const guarded = await applySettingsGuarded({ forms: [] }, actorForAudit(req)?.sub ?? "admin");
    if (!guarded.applied) {
      res.status(202).json({ pending: guarded.pending, message: "This change needs a signed sign-off before it applies. See /api/approvals/inbox." });
      return;
    }
    captureVersion("forms drained (migrated to definitions)");
    res.json({ forms: getSettings().forms });
  } catch (err) {
    if (err instanceof SettingsValidationError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
});

export default router;
