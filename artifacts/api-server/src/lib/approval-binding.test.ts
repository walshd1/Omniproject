import { test } from "node:test";
import assert from "node:assert/strict";
import { validateApprovalBindings, ApprovalBindingError } from "./approval-binding";
import { chainForAction, proposeIfBound } from "./approval-gate";
import { updateSettings, getSettings } from "./settings";
import { loadProposal } from "./approval-service";
import type { ChainDef } from "./approval-chain";

const CHAIN: ChainDef = {
  id: "two-admin", scope: { kind: "org" }, rejectionPolicy: "abort", requireDistinctApprovers: true,
  stages: [{ id: "s1", approvers: [{ kind: "role", role: "admin" }] }, { id: "s2", approvers: [{ kind: "role", role: "admin" }] }],
};

test("validateApprovalBindings accepts good bindings, rejects bad shape and duplicate actions", () => {
  assert.deepEqual(validateApprovalBindings([{ action: "a", chainId: "c" }]), [{ action: "a", chainId: "c" }]);
  assert.throws(() => validateApprovalBindings("no" as unknown), ApprovalBindingError);
  assert.throws(() => validateApprovalBindings([{ action: "", chainId: "c" }]), /non-empty/);
  assert.throws(() => validateApprovalBindings([{ action: "a", chainId: "c" }, { action: "a", chainId: "d" }]), /bound more than once/);
});

test("chainForAction resolves the bound chain, and is null when unbound or the chain is missing", () => {
  const prev = { chains: getSettings().approvalChains, bindings: getSettings().approvalBindings };
  try {
    updateSettings({ approvalChains: [CHAIN], approvalBindings: [{ action: "danger", chainId: "two-admin" }] });
    assert.equal(chainForAction("danger")?.id, "two-admin");
    assert.equal(chainForAction("unbound"), null);
    // a dangling binding (chain id doesn't exist) resolves to null (fail-open to direct execution)
    updateSettings({ approvalBindings: [{ action: "danger", chainId: "gone" }] });
    assert.equal(chainForAction("danger"), null);
  } finally {
    updateSettings({ approvalChains: prev.chains, approvalBindings: prev.bindings });
  }
});

test("proposeIfBound raises a proposal for a bound action, returns null for an unbound one", async () => {
  const prev = { chains: getSettings().approvalChains, bindings: getSettings().approvalBindings };
  try {
    updateSettings({ approvalChains: [CHAIN], approvalBindings: [{ action: "danger", chainId: "two-admin" }] });
    const id = await proposeIfBound("danger", { x: 1 }, "initiator");
    assert.ok(id, "a bound action creates a proposal");
    const p = await loadProposal(id!);
    assert.equal(p?.action, "danger");
    assert.equal(p?.state.proposedBy, "initiator");
    assert.equal(p?.def.requireDistinctApprovers, true); // the two-distinct-admins dual-control chain
    // unbound → null (caller executes directly)
    assert.equal(await proposeIfBound("not-bound", {}, "initiator"), null);
  } finally {
    updateSettings({ approvalChains: prev.chains, approvalBindings: prev.bindings });
  }
});
