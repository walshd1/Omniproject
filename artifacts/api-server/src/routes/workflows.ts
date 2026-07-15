import { Router } from "express";
import { hasRole, requireRole, type Role } from "../lib/rbac";
import { getSettings } from "../lib/settings";
import { contextFromReq } from "../broker";
import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { proposeIfBound } from "../lib/approval-gate";
import { ensureWorkflowExecutor, runStoredWorkflow, workflowRunAction, type RunActor } from "../lib/workflow-run";

/**
 * WORKFLOW authoring + running (design §5).
 *  - GET  /workflows            — the stored workflow definitions (any authenticated session).
 *  - PUT  /workflows            — author them (pmo+; validated in updateSettings → validateWorkflows, so a
 *                                 malformed PUT is a 400 and nothing persists).
 *  - POST /workflows/:id/run    — run one. Authorization is SCOPED to the workflow: an org workflow needs
 *                                 pmo+, a project workflow needs manager+ (a PM). If the run action is bound
 *                                 to an approval chain, the run is HELD for a signed sign-off (202) and only
 *                                 executes when the chain approves — under the proposer's recorded identity.
 *
 * The run effect is a fail-closed allowlist (broker reads + notify) — a workflow can observe + inform but
 * never silently mutate; a mutation is an approval-gated autonomous act, not a plain step. See
 * lib/workflow-run.ts and docs/design/WORKFLOW-APPROVAL-CHAINS.md.
 */
const router = Router();

router.post("/workflows/:id/run", async (req, res) => {
  const id = String(req.params["id"] ?? "");
  const def = getSettings().workflows.find((w) => w.id === id);
  if (!def) { res.status(404).json({ error: `unknown workflow "${id}"` }); return; }

  // Scope-gated authority: org workflows are a PMO act, project workflows a PM (manager) act.
  const need: Role = def.scope.kind === "org" ? "pmo" : "manager";
  if (!hasRole(req, need)) {
    res.status(403).json({ error: `running a ${def.scope.kind} workflow needs ${need}+` });
    return;
  }

  const c = contextFromReq(req);
  if (!c.sub) { res.status(401).json({ error: "unauthenticated" }); return; }
  const actor: RunActor = { sub: c.sub, email: c.email, name: c.name, role: c.role, scope: c.scope };

  // If this workflow's run is bound to a chain, HOLD it: register the executor (so an approval fires the
  // run under the proposer's recorded actor), then raise the proposal and return 202. Unbound ⇒ run now.
  ensureWorkflowExecutor(id);
  const action = workflowRunAction(id);
  const proposalId = await proposeIfBound(action, { id, owner: actor.sub, actor }, actor.sub);
  if (proposalId) {
    res.status(202).json({
      pending: { proposalId, action },
      message: "This workflow run needs a signed sign-off before it executes. See /api/approvals/inbox.",
    });
    return;
  }

  try {
    const ctx = await runStoredWorkflow(req, id, actor.sub);
    res.json({ ran: id, results: ctx.results });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "workflow run failed" });
  }
});

router.use(
  settingsCollectionRouter({
    path: "/workflows",
    settingsKey: "workflows",
    versionLabel: "workflows updated",
    writeGuards: [requireRole("pmo")],
  }),
);

export default router;
