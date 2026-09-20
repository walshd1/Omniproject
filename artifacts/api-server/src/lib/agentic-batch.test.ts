import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyBatchAction, isBatchExecutable, validateBatchPlan, BatchPlanError,
  AGENTIC_BATCH_ACTIONS, MAX_BATCH_ACTIONS,
} from "./agentic-batch";

/**
 * Supervised agentic execution (D1) — the action-class boundary. The agent may EXECUTE inform + low-risk
 * reversible edits; everything else (structural creation, financial) stays propose-only. This is the tested
 * encoding of that policy, so it can't silently widen.
 */

test("classifyBatchAction: inform vs low-risk-edit vs excluded", () => {
  assert.equal(classifyBatchAction("notify"), "inform");
  for (const edit of ["set-field", "set-status", "assign", "add-label"]) {
    assert.equal(classifyBatchAction(edit), "low-risk-edit");
  }
  // Structural + financial catalogue actions are excluded (propose-only), as is any unknown kind.
  assert.equal(classifyBatchAction("create-issue"), "excluded");
  assert.equal(classifyBatchAction("run-depreciation"), "excluded");
  assert.equal(classifyBatchAction("delete-everything"), "excluded");
});

test("isBatchExecutable follows the allowlist; the allowlist is exactly the low-risk set", () => {
  assert.equal(isBatchExecutable("set-status"), true);
  assert.equal(isBatchExecutable("create-issue"), false);
  assert.equal(isBatchExecutable("run-depreciation"), false);
  assert.deepEqual([...AGENTIC_BATCH_ACTIONS].sort(), ["add-label", "assign", "notify", "set-field", "set-status"]);
});

test("validateBatchPlan accepts a well-formed inform + low-risk-edit batch", () => {
  const plan = validateBatchPlan({
    scope: { kind: "project", projectId: "proj-1" },
    actions: [
      { kind: "notify", params: { to: "pm@x.io", message: "triaged" } },
      { kind: "set-status", params: { status: "in-progress" } },
    ],
  });
  assert.equal(plan.scope.kind, "project");
  assert.equal(plan.actions.length, 2);
  assert.equal(plan.actions[1]!.kind, "set-status");
});

test("validateBatchPlan rejects an action targeting a project OUTSIDE the declared project scope", () => {
  // The JIT grant's projects derive from action params, so an out-of-scope action would expand the grant.
  assert.throws(
    () => validateBatchPlan({
      scope: { kind: "project", projectId: "proj-1" },
      actions: [{ kind: "set-status", params: { status: "done", projectId: "proj-2" } }],
    }),
    (e: unknown) => e instanceof BatchPlanError && /outside the declared batch scope/.test((e as Error).message),
  );
  // In-scope projectId, or an org-scoped (intentionally cross-project) batch, is accepted.
  assert.doesNotThrow(() => validateBatchPlan({
    scope: { kind: "project", projectId: "proj-1" },
    actions: [{ kind: "set-status", params: { status: "done", projectId: "proj-1" } }],
  }));
  assert.doesNotThrow(() => validateBatchPlan({
    scope: { kind: "org" },
    actions: [{ kind: "set-status", params: { status: "done", projectId: "anything" } }],
  }));
});

test("validateBatchPlan rejects a propose-only action, naming it", () => {
  assert.throws(
    () => validateBatchPlan({ scope: { kind: "org" }, actions: [{ kind: "create-issue", params: {} }] }),
    (e: unknown) => e instanceof BatchPlanError && /create-issue/.test((e as Error).message) && /propose-only/.test((e as Error).message),
  );
  assert.throws(
    () => validateBatchPlan({ scope: { kind: "org" }, actions: [{ kind: "run-depreciation", params: {} }] }),
    BatchPlanError,
  );
});

test("validateBatchPlan enforces shape: scope, non-empty, cap, params object, no forbidden keys", () => {
  assert.throws(() => validateBatchPlan({ scope: { kind: "nope" }, actions: [{ kind: "notify", params: {} }] }), BatchPlanError);
  assert.throws(() => validateBatchPlan({ scope: { kind: "org" }, actions: [] }), BatchPlanError);
  assert.throws(() => validateBatchPlan({ scope: { kind: "org" },
    actions: Array.from({ length: MAX_BATCH_ACTIONS + 1 }, () => ({ kind: "notify", params: {} })) }), BatchPlanError);
  assert.throws(() => validateBatchPlan({ scope: { kind: "org" }, actions: [{ kind: "notify" }] }), BatchPlanError); // no params
  assert.throws(() => validateBatchPlan({ scope: { kind: "org" }, actions: [{ kind: "notify", params: [] }] }), BatchPlanError); // array params
  // JSON.parse (not an object literal) creates a real own "__proto__" key that Object.keys can see.
  assert.throws(
    () => validateBatchPlan({ scope: { kind: "org" }, actions: [{ kind: "notify", params: JSON.parse('{"__proto__":"x"}') }] }),
    BatchPlanError,
  );
});
