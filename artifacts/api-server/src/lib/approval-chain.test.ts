import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startChain, applyDecision, isEligible, redirectStage, bypassChain, activeStage,
  ApprovalChainError, type ChainDef, type Decision, type Actor,
} from "./approval-chain";

const def = (over: Partial<ChainDef> = {}): ChainDef => ({
  id: "c1",
  scope: { kind: "org" },
  rejectionPolicy: "abort",
  stages: [
    { id: "s1", approvers: [{ kind: "role", role: "pm" }] },
    { id: "s2", approvers: [{ kind: "user", sub: "pmo-1" }] },
  ],
  ...over,
});

const human = (sub: string, roles: string[]): Actor => ({ sub, roles, via: "human" });
const dec = (stageId: string, by: string, decision: "approve" | "reject", via: "human" | "ai" = "human"): Decision =>
  ({ stageId, by, via, decision, at: "2026-01-01T00:00:00Z", sigRef: `sig-${by}-${stageId}` });

test("eligibility matches a named user or a held role", () => {
  const d = def();
  assert.equal(isEligible(d.stages[0]!, human("x", ["pm"])), true);
  assert.equal(isEligible(d.stages[0]!, human("x", ["viewer"])), false);
  assert.equal(isEligible(d.stages[1]!, human("pmo-1", [])), true);
  assert.equal(isEligible(d.stages[1]!, human("pmo-2", ["pmo"])), false); // named user, role doesn't help
});

test("a full sequential chain: approve each stage in order → approved", () => {
  const d = def();
  let s = startChain(d, "p1", "maker");
  assert.equal(activeStage(d, s)!.id, "s1");
  s = applyDecision(d, s, dec("s1", "alice", "approve"), human("alice", ["pm"]));
  assert.equal(s.status, "pending");
  assert.equal(activeStage(d, s)!.id, "s2");
  s = applyDecision(d, s, dec("s2", "pmo-1", "approve"), human("pmo-1", ["pmo"]));
  assert.equal(s.status, "approved");
  assert.equal(activeStage(d, s), null);
  assert.equal(s.decisions.length, 2);
});

test("separation of duties: the proposer can never approve", () => {
  const d = def();
  const s = startChain(d, "p1", "alice");
  assert.throws(() => applyDecision(d, s, dec("s1", "alice", "approve"), human("alice", ["pm"])), ApprovalChainError);
});

test("an ineligible actor is refused", () => {
  const d = def();
  const s = startChain(d, "p1", "maker");
  assert.throws(() => applyDecision(d, s, dec("s1", "bob", "approve"), human("bob", ["viewer"])), /not an approver/);
});

test("a decision must target the active stage, not a later one", () => {
  const d = def();
  const s = startChain(d, "p1", "maker");
  assert.throws(() => applyDecision(d, s, dec("s2", "pmo-1", "approve"), human("pmo-1", ["pmo"])), /active stage/);
});

test("an actor cannot decide the same stage twice", () => {
  // Two eligible approvers on stage 1; the first decides, then tries again.
  const d = def({ stages: [{ id: "s1", approvers: [{ kind: "role", role: "pm" }] }] });
  let s = startChain(d, "p1", "maker");
  // approving the only stage completes the chain, so test double-decide on a rejected-send-back setup instead:
  const d2 = def({ rejectionPolicy: "send-back", stages: [
    { id: "s1", approvers: [{ kind: "role", role: "pm" }] },
    { id: "s2", approvers: [{ kind: "role", role: "pmo" }] },
  ] });
  s = startChain(d2, "p1", "maker");
  s = applyDecision(d2, s, dec("s1", "alice", "approve"), human("alice", ["pm"]));
  s = applyDecision(d2, s, dec("s2", "bob", "reject"), human("bob", ["pmo"])); // send-back to s1
  assert.equal(activeStage(d2, s)!.id, "s1");
  assert.throws(() => applyDecision(d2, s, dec("s1", "alice", "approve"), human("alice", ["pm"])), /already decided/);
});

test("rejection policy abort: any reject settles the chain as rejected", () => {
  const d = def({ rejectionPolicy: "abort" });
  let s = startChain(d, "p1", "maker");
  s = applyDecision(d, s, dec("s1", "alice", "reject"), human("alice", ["pm"]));
  assert.equal(s.status, "rejected");
});

test("rejection policy send-back: returns to the previous stage; stage-0 send-back aborts", () => {
  const d = def({ rejectionPolicy: "send-back" });
  let s = startChain(d, "p1", "maker");
  s = applyDecision(d, s, dec("s1", "alice", "approve"), human("alice", ["pm"])); // now at s2
  s = applyDecision(d, s, dec("s2", "pmo-1", "reject"), human("pmo-1", ["pmo"])); // send back to s1
  assert.equal(s.status, "pending");
  assert.equal(activeStage(d, s)!.id, "s1");
  // A reject at stage 0 has nowhere to go back to → aborts.
  s = applyDecision(d, s, dec("s1", "carol", "reject"), human("carol", ["pm"]));
  assert.equal(s.status, "rejected");
});

test("a humanOnly stage cannot be completed by an AI decision", () => {
  const d = def({ stages: [{ id: "s1", approvers: [{ kind: "role", role: "pm" }], humanOnly: true }] });
  const s = startChain(d, "p1", "maker");
  assert.throws(() => applyDecision(d, s, dec("s1", "bot", "approve", "ai"), { sub: "bot", roles: ["pm"], via: "ai" }), /requires a human/);
});

test("requireDistinctApprovers stops one insider satisfying two stages (dual-control)", () => {
  // A 2-stage privileged action; alice is eligible for BOTH stages (e.g. holds pmo).
  const d = def({ requireDistinctApprovers: true, stages: [
    { id: "s1", approvers: [{ kind: "role", role: "pmo" }] },
    { id: "s2", approvers: [{ kind: "role", role: "pmo" }] },
  ] });
  let s = startChain(d, "p1", "maker");
  s = applyDecision(d, s, dec("s1", "alice", "approve"), human("alice", ["pmo"]));
  // alice cannot also satisfy stage 2 — a SECOND distinct human is required.
  assert.throws(() => applyDecision(d, s, dec("s2", "alice", "approve"), human("alice", ["pmo"])), /distinct approvers/);
  // a different pmo completes it.
  s = applyDecision(d, s, dec("s2", "bob", "approve"), human("bob", ["pmo"]));
  assert.equal(s.status, "approved");
});

test("without requireDistinctApprovers, the same eligible person MAY satisfy consecutive stages", () => {
  const d = def({ stages: [
    { id: "s1", approvers: [{ kind: "role", role: "pmo" }] },
    { id: "s2", approvers: [{ kind: "role", role: "pmo" }] },
  ] });
  let s = startChain(d, "p1", "maker");
  s = applyDecision(d, s, dec("s1", "alice", "approve"), human("alice", ["pmo"]));
  s = applyDecision(d, s, dec("s2", "alice", "approve"), human("alice", ["pmo"]));
  assert.equal(s.status, "approved"); // default behaviour unchanged
});

test("PMO redirect reassigns the current stage's approvers", () => {
  const d = def();
  const s = startChain(d, "p1", "maker");
  const r = redirectStage(d, s, [{ kind: "user", sub: "stand-in" }]);
  assert.deepEqual(r.def.stages[0]!.approvers, [{ kind: "user", sub: "stand-in" }]);
  // the redirected approver can now satisfy the stage; the original role holder no longer can
  assert.equal(isEligible(r.def.stages[0]!, human("stand-in", [])), true);
  assert.equal(isEligible(r.def.stages[0]!, human("alice", ["pm"])), false);
});

test("PMO bypass forces approved and records the bypassing decision", () => {
  const d = def();
  const s = startChain(d, "p1", "maker");
  const b = bypassChain(s, dec("s1", "pmo-boss", "approve"));
  assert.equal(b.status, "approved");
  assert.equal(b.decisions.at(-1)!.by, "pmo-boss"); // never silent
});

test("no decisions after the chain settles", () => {
  const d = def({ stages: [{ id: "s1", approvers: [{ kind: "role", role: "pm" }] }] });
  let s = startChain(d, "p1", "maker");
  s = applyDecision(d, s, dec("s1", "alice", "approve"), human("alice", ["pm"]));
  assert.equal(s.status, "approved");
  assert.throws(() => applyDecision(d, s, dec("s1", "bob", "approve"), human("bob", ["pm"])), /already approved/);
});
