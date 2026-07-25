import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { ActorContext } from "../broker/types";
import { updateSettings } from "./settings";
import {
  isDigest, PROMOTE_ACTION, approvedPromotion, __resetPromotion,
  recordApprovedPromotion, ensurePromotionExecutor, runPromotionExecutor, proposePromotion,
} from "./release-promotion";

/**
 * Phase-3 approval-gated promotion (docs/UPDATE-MECHANISM.md §7). Promotion records the approved production
 * digest; unbound it applies immediately, bound to a chain it is HELD for passkey sign-off and records only
 * when the executor fires on approval. Either way the decision is audited.
 */

const D = "sha256:deadbeefcafe0123";
const admin = (): ActorContext => ({ sub: "admin-1", actorKind: "human" } as ActorContext);

beforeEach(() => { __resetPromotion(); updateSettings({ approvalChains: [], approvalBindings: [] }); });
afterEach(() => { __resetPromotion(); updateSettings({ approvalChains: [], approvalBindings: [] }); });

test("isDigest accepts sha256 content digests and rejects everything else", () => {
  assert.equal(isDigest(D), true);
  assert.equal(isDigest("sha256:ABCDEF01"), true); // case-insensitive
  assert.equal(isDigest("sha256:xyz"), false);     // non-hex
  assert.equal(isDigest("deadbeef"), false);       // no algo prefix
  assert.equal(isDigest("md5:deadbeef"), false);   // wrong algo
  assert.equal(isDigest(""), false);
  assert.equal(isDigest(undefined), false);
  assert.equal(isDigest(42), false);
});

test("recordApprovedPromotion sets the current approved digest with attribution", () => {
  assert.equal(approvedPromotion(), null);
  const rec = recordApprovedPromotion(D, "org accepted", "admin-1", "2026-07-25T00:00:00.000Z");
  assert.deepEqual(rec, { digest: D, approvedBy: "admin-1", approvedAt: "2026-07-25T00:00:00.000Z", note: "org accepted" });
  assert.deepEqual(approvedPromotion(), rec);
});

test("recordApprovedPromotion omits an absent note (no undefined key)", () => {
  const rec = recordApprovedPromotion(D, undefined, "admin-1", "2026-07-25T00:00:00.000Z");
  assert.equal("note" in rec, false);
});

test("proposePromotion applies immediately when the action is unbound", async () => {
  const outcome = await proposePromotion(admin(), D, "ship it");
  assert.equal(outcome.held, false);
  assert.equal(outcome.proposalId, undefined);
  assert.deepEqual(approvedPromotion(), outcome.promotion);
  assert.equal(approvedPromotion()?.digest, D);
});

test("proposePromotion HOLDS (nothing recorded) when release.promote is bound to a chain", async () => {
  updateSettings({
    approvalChains: [{ id: "prod-chain", scope: { kind: "org" }, rejectionPolicy: "abort", stages: [{ id: "s1", approvers: [{ kind: "role", role: "admin" }] }] }],
    approvalBindings: [{ action: PROMOTE_ACTION, chainId: "prod-chain" }],
  });
  const outcome = await proposePromotion(admin(), D, undefined);
  assert.equal(outcome.held, true);
  assert.ok(outcome.proposalId, "a proposal id is returned for the held promotion");
  assert.equal(approvedPromotion(), null); // nothing durable until sign-off
});

test("the executor records the promotion from the proposal params (the bound sign-off path)", () => {
  ensurePromotionExecutor(); // idempotent registration into the approval service — must not throw
  runPromotionExecutor({ digest: D, actorSub: "admin-2", note: "approved" });
  assert.equal(approvedPromotion()?.digest, D);
  assert.equal(approvedPromotion()?.approvedBy, "admin-2");
  assert.equal(approvedPromotion()?.note, "approved");
});

test("the executor refuses a proposal that carries no digest", () => {
  assert.throws(() => runPromotionExecutor({ actorSub: "admin-2" }), /missing its digest/);
  assert.throws(() => runPromotionExecutor({}), /missing its digest/);
  assert.equal(approvedPromotion(), null);
});
