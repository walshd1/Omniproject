import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  compileBatchToWorkflow, buildBatchGrant, previewBatch, runApprovedBatch, proposeBatch, pendingBatchesFor,
  batchActorId, BATCH_APPROVAL_ACTION, BATCH_WRITE_ACTION,
} from "./agentic-batch-run";
import { getAutonomousGrant, __resetAutonomousGrants } from "./autonomous-grant";
import { authorizedRole } from "./autonomous";
import { setContainmentRelax, __resetContainmentRelax } from "./ai-containment";
import { getSettings, updateSettings } from "./settings";
import { BatchPlanError, type AgenticBatchPlan } from "./agentic-batch";

/**
 * Supervised agentic execution (D1) — execution half, JUST-IN-TIME authority. A batch has NO standing write
 * authority; on approval a per-batch actor + a grant scoped to exactly the plan are minted, and both are torn
 * down after the run. These tests relax AI containment to "off" (the containment gate is tested separately)
 * to isolate the batch lifecycle.
 */
const ORIGINAL = getSettings();
beforeEach(() => setContainmentRelax("off"));
afterEach(() => {
  __resetAutonomousGrants();
  __resetContainmentRelax();
  updateSettings({ approvalChains: ORIGINAL.approvalChains ?? [], approvalBindings: ORIGINAL.approvalBindings ?? [] });
});

/** A minimal org-scoped chain requiring one manager approval, bound to the batch action. */
function enableBatchApprovals(): void {
  updateSettings({
    approvalChains: [{ id: "c-batch", scope: { kind: "org" }, rejectionPolicy: "abort", stages: [{ id: "s1", approvers: [{ kind: "role", role: "manager" }] }] }],
    approvalBindings: [{ action: BATCH_APPROVAL_ACTION, chainId: "c-batch" }],
  });
}

const PLAN: AgenticBatchPlan = {
  scope: { kind: "project", projectId: "P1" },
  actions: [
    { kind: "notify", params: { to: "pm@x.io", message: "done" } },
    { kind: "set-status", params: { issueId: "I1", status: "in-progress" } },
  ],
};

test("compileBatchToWorkflow maps actions to effects and stamps the update op", () => {
  const def = compileBatchToWorkflow(PLAN, "b1");
  assert.equal(def.steps.length, 2);
  assert.equal(def.steps[0]!.action, "notify");
  assert.equal(def.steps[1]!.action, "broker.writeIssue");
  assert.equal((def.steps[1]!.params as Record<string, unknown>)["__op"], "update");
});

test("buildBatchGrant is scoped to exactly the plan: update_issue, the plan's projects, maxWrites = write count", () => {
  const g = buildBatchGrant(PLAN, "b1", 1_000_000);
  assert.equal(g.actorId, batchActorId("b1"));
  assert.deepEqual(g.actions, [BATCH_WRITE_ACTION]);
  assert.deepEqual(g.projects, ["P1"]);
  assert.equal(g.maxWrites, 1);                 // one mutating action (set-status); notify is inform
  assert.equal(typeof g.notAfter, "number");    // short expiry
});

test("previewBatch reflects the post-approval grant, then leaves NO standing authority behind", () => {
  const now = 1_000_000;
  const preview = previewBatch(PLAN, "b1", now);
  assert.equal(preview[0]!.allowed, true);  // notify — inform
  assert.equal(preview[1]!.allowed, true);  // set-status — admitted by the JIT grant built for this plan
  // Teardown: the transient actor + grant used for the dry-run are gone.
  assert.equal(getAutonomousGrant(batchActorId("b1")), undefined);
  assert.equal(authorizedRole(batchActorId("b1")), undefined);
});

test("the batch approval action is NOT a workflow.run action — only a human can approve a batch", () => {
  assert.equal(BATCH_APPROVAL_ACTION, "agentic.batch");
  assert.equal(/^workflow\.run:/.test(BATCH_APPROVAL_ACTION), false);
});

test("runApprovedBatch tears down the JIT grant + actor after the run — authority never outlives approval", async () => {
  // Whether the underlying write succeeds or throws in this unit context, the finally must clean up.
  await runApprovedBatch("b1", PLAN, { onBehalfOf: "u1" }).catch(() => {});
  assert.equal(getAutonomousGrant(batchActorId("b1")), undefined);
  assert.equal(authorizedRole(batchActorId("b1")), undefined);
});

test("proposeBatch fails closed when no approval chain is bound (supervised execution off by default)", async () => {
  await assert.rejects(() => proposeBatch(PLAN, "u1"), BatchPlanError);
});

test("proposeBatch raises ONE approval proposal and returns the dry-run preview when a chain is bound", async () => {
  enableBatchApprovals();
  const res = await proposeBatch(PLAN, "u1");
  assert.equal(typeof res.batchId, "string");
  assert.equal(typeof res.proposalId, "string");
  assert.equal(res.preview.length, 2);
  assert.equal(res.preview[1]!.allowed, true); // set-status admitted by the JIT grant it would mint
  // Proposing does not itself grant anything standing — nothing runs until a human approves.
  assert.equal(getAutonomousGrant(batchActorId(res.batchId)), undefined);
});

test("pendingBatchesFor offers a bound batch to an eligible approver (with plan+preview), never to its proposer", async () => {
  enableBatchApprovals();
  const { proposalId, batchId } = await proposeBatch(PLAN, "u1");

  const asApprover = await pendingBatchesFor({ sub: "mgr-1", roles: ["manager"], via: "human" });
  const mine = asApprover.find((p) => p.proposalId === proposalId);
  assert.ok(mine, "an eligible manager is offered the batch to review");
  assert.equal(mine!.batchId, batchId);
  assert.equal(mine!.plan.actions.length, 2);
  assert.ok(mine!.preview.length >= 1, "the approver sees a dry-run preview of the actions");

  // The proposer is never offered their own batch (self-approval is refused).
  const asProposer = await pendingBatchesFor({ sub: "u1", roles: ["manager"], via: "human" });
  assert.equal(asProposer.some((p) => p.proposalId === proposalId), false);
});

test("proposeBatch rejects a plan with a propose-only action (allowlist re-checked at the boundary)", async () => {
  enableBatchApprovals();
  await assert.rejects(
    () => proposeBatch({ scope: { kind: "org" }, actions: [{ kind: "create-issue", params: {} }] }, "u1"),
    BatchPlanError,
  );
});
