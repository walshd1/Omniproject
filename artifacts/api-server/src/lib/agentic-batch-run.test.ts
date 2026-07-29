import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  compileBatchToWorkflow, buildBatchGrant, previewBatch, runApprovedBatch,
  batchActorId, batchRunAction, BATCH_WRITE_ACTION,
} from "./agentic-batch-run";
import { getAutonomousGrant, __resetAutonomousGrants } from "./autonomous-grant";
import { authorizedRole } from "./autonomous";
import { setContainmentRelax, __resetContainmentRelax } from "./ai-containment";
import type { AgenticBatchPlan } from "./agentic-batch";

/**
 * Supervised agentic execution (D1) — execution half, JUST-IN-TIME authority. A batch has NO standing write
 * authority; on approval a per-batch actor + a grant scoped to exactly the plan are minted, and both are torn
 * down after the run. These tests relax AI containment to "off" (the containment gate is tested separately)
 * to isolate the batch lifecycle.
 */
beforeEach(() => setContainmentRelax("off"));
afterEach(() => { __resetAutonomousGrants(); __resetContainmentRelax(); });

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

test("batchRunAction is NOT a workflow.run action — only a human can approve a batch", () => {
  assert.equal(batchRunAction("b1"), "agentic.batch:b1");
  assert.equal(/^workflow\.run:/.test(batchRunAction("b1")), false);
});

test("runApprovedBatch tears down the JIT grant + actor after the run — authority never outlives approval", async () => {
  // Whether the underlying write succeeds or throws in this unit context, the finally must clean up.
  await runApprovedBatch("b1", PLAN, { approverSub: "u1" }).catch(() => {});
  assert.equal(getAutonomousGrant(batchActorId("b1")), undefined);
  assert.equal(authorizedRole(batchActorId("b1")), undefined);
});
