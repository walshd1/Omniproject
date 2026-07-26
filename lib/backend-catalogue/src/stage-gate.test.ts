import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateGate } from "./stage-gate";

// Two entry criteria: budget approved (mandatory) + readiness ≥ 80 (mandatory).
const criteria = [
  { id: "budget", when: { all: [{ field: "budgetApproved", op: "truthy" as const }] }, mandatory: true },
  { id: "readiness", when: { all: [{ field: "readiness", op: "gte" as const, value: 80 }] }, mandatory: true },
];

test("all mandatory criteria met + required approvals ⇒ passed", () => {
  const r = evaluateGate({
    criteria,
    context: { budgetApproved: true, readiness: 90 },
    approvals: [{ approver: "pmo", decision: "approve" }],
  });
  assert.equal(r.decision, "passed");
  assert.equal(r.criteriaScore, 1);
  assert.deepEqual(r.blockers, []);
  assert.equal(r.approvals.satisfied, true);
});

test("an unmet mandatory criterion ⇒ failed, with the criterion listed as a blocker", () => {
  const r = evaluateGate({
    criteria,
    context: { budgetApproved: true, readiness: 50 }, // readiness below threshold
    approvals: [{ approver: "pmo", decision: "approve" }],
  });
  assert.equal(r.decision, "failed");
  assert.deepEqual(r.blockers, ["criterion:readiness"]);
  assert.equal(r.criteriaScore, 0.5); // 1 of 2 met
});

test("a rejection fails the gate even when all criteria are met", () => {
  const r = evaluateGate({
    criteria,
    context: { budgetApproved: true, readiness: 90 },
    approvals: [{ approver: "pmo", decision: "approve" }, { approver: "cfo", decision: "reject" }],
  });
  assert.equal(r.decision, "failed");
  assert.deepEqual(r.blockers, ["rejected-by:cfo"]);
});

test("criteria met but approvals outstanding ⇒ pending", () => {
  const r = evaluateGate({
    criteria,
    context: { budgetApproved: true, readiness: 90 },
    approvals: [{ approver: "pmo", decision: "approve" }, { approver: "cfo", decision: "pending" }],
  });
  assert.equal(r.decision, "pending");
  assert.equal(r.approvals.required, 2); // default: every listed approver must approve
  assert.deepEqual(r.blockers, ["awaiting-approvals:1"]);
});

test("an explicit waiver short-circuits to waived and clears blockers", () => {
  const r = evaluateGate({
    criteria,
    context: { budgetApproved: false, readiness: 10 }, // would otherwise fail
    waived: true,
  });
  assert.equal(r.decision, "waived");
  assert.deepEqual(r.blockers, []);
  // Criteria are still evaluated + reported honestly even under a waiver.
  assert.equal(r.criteria.find((c) => c.id === "budget")!.met, false);
});

test("a non-mandatory criterion only lowers the score, never fails the gate", () => {
  const r = evaluateGate({
    criteria: [
      { id: "must", when: { all: [{ field: "ok", op: "truthy" as const }] }, mandatory: true },
      { id: "nice", when: { all: [{ field: "bonus", op: "truthy" as const }] }, mandatory: false },
    ],
    context: { ok: true, bonus: false },
  });
  assert.equal(r.decision, "passed"); // mandatory met, no approvals required
  assert.equal(r.criteriaScore, 0.5); // the optional criterion is unmet
});

test("weights move the readiness score; the divide is guarded when nothing carries weight", () => {
  const weighted = evaluateGate({
    criteria: [
      { id: "big", when: { all: [{ field: "a", op: "truthy" as const }] }, weight: 3 },
      { id: "small", when: { all: [{ field: "b", op: "truthy" as const }] }, weight: 1 },
    ],
    context: { a: true, b: false },
  });
  assert.equal(weighted.criteriaScore, 0.75); // 3 of 4 weight met

  const zeroWeight = evaluateGate({ criteria: [{ id: "x", weight: 0 }], context: {} });
  assert.equal(zeroWeight.criteriaScore, null); // total weight 0 ⇒ null, never NaN
});

test("empty gate (no criteria, no approvals) ⇒ passed with a null score", () => {
  const r = evaluateGate({ criteria: [] });
  assert.equal(r.decision, "passed");
  assert.equal(r.criteriaScore, null);
  assert.deepEqual(r.blockers, []);
  assert.equal(r.approvals.required, 0);
});

test("requiredApprovals is coerced and clamped to the number of approvals", () => {
  const r = evaluateGate({
    criteria: [],
    approvals: [{ approver: "a", decision: "approve" }, { approver: "b", decision: "approve" }],
    requiredApprovals: 99, // clamped to 2
  });
  assert.equal(r.approvals.required, 2);
  assert.equal(r.decision, "passed"); // both approved
});

test("a dirty / non-finite weight is coerced, never NaN", () => {
  const r = evaluateGate({
    criteria: [
      { id: "a", when: { all: [{ field: "x", op: "truthy" as const }] }, weight: "2" as unknown as number },
      { id: "b", when: { all: [{ field: "y", op: "truthy" as const }] }, weight: NaN as unknown as number },
    ],
    context: { x: true, y: true },
  });
  assert.equal(r.criteriaScore, 1); // both met; NaN weight → 0, "2" → 2, all met ⇒ 1
  assert.equal(Number.isNaN(r.criteriaScore as number), false);
});
