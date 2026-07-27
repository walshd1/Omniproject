import { test } from "node:test";
import assert from "node:assert/strict";
import { findSeparationOfDutiesConflicts, type SoDAssignment, type SoDPolicy } from "./separation-of-duties";

const PAYMENTS: SoDPolicy = {
  id: "pay-sod",
  label: "Create vs approve payment",
  severity: "critical",
  a: ["create_payment"],
  b: ["approve_payment"],
};

test("classic toxic combination is detected when a subject holds both sides", () => {
  const r = findSeparationOfDutiesConflicts([{ subjectId: "u", grants: ["create_payment", "approve_payment"] }], [PAYMENTS]);
  assert.equal(r.conflicts.length, 1);
  const c = r.conflicts[0]!;
  assert.equal(c.subjectId, "u");
  assert.equal(c.policyId, "pay-sod");
  assert.equal(c.policyLabel, "Create vs approve payment");
  assert.equal(c.severity, "critical");
  assert.deepEqual(c.grantsFromA, ["create_payment"]);
  assert.deepEqual(c.grantsFromB, ["approve_payment"]);
});

test("no conflict when a subject holds only one side", () => {
  const r = findSeparationOfDutiesConflicts([{ subjectId: "u", grants: ["create_payment"] }], [PAYMENTS]);
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.bySubject.length, 0);
  assert.deepEqual(r.counts, { low: 0, medium: 0, high: 0, critical: 0 });
});

test("multiple grants on a side are all listed, id-sorted", () => {
  const policy: SoDPolicy = { id: "p", label: "P", severity: "high", a: ["a1", "a2"], b: ["b1", "b2"] };
  const r = findSeparationOfDutiesConflicts([{ subjectId: "u", grants: ["b2", "a2", "a1", "b1"] }], [policy]);
  assert.equal(r.conflicts.length, 1);
  assert.deepEqual(r.conflicts[0]!.grantsFromA, ["a1", "a2"]);
  assert.deepEqual(r.conflicts[0]!.grantsFromB, ["b1", "b2"]);
});

test("findings across policies and subjects are ranked severity-first, then subject, then policy", () => {
  const policies: SoDPolicy[] = [
    { id: "p-low", label: "low", severity: "low", a: ["x"], b: ["y"] },
    { id: "p-crit", label: "crit", severity: "critical", a: ["x"], b: ["y"] },
    { id: "p-crit2", label: "crit2", severity: "critical", a: ["x"], b: ["y"] },
  ];
  const assignments: SoDAssignment[] = [
    { subjectId: "bob", grants: ["x", "y"] },
    { subjectId: "amy", grants: ["x", "y"] },
  ];
  const r = findSeparationOfDutiesConflicts(assignments, policies);
  // critical (amy p-crit, amy p-crit2, bob p-crit, bob p-crit2) then low (amy p-low, bob p-low)
  assert.deepEqual(
    r.conflicts.map((c) => `${c.severity}:${c.subjectId}:${c.policyId}`),
    ["critical:amy:p-crit", "critical:amy:p-crit2", "critical:bob:p-crit", "critical:bob:p-crit2", "low:amy:p-low", "low:bob:p-low"],
  );
});

test("per-subject rollup reports count and worst severity", () => {
  const policies: SoDPolicy[] = [
    { id: "p-med", label: "m", severity: "medium", a: ["x"], b: ["y"] },
    { id: "p-crit", label: "c", severity: "critical", a: ["x"], b: ["y"] },
  ];
  const r = findSeparationOfDutiesConflicts([{ subjectId: "u", grants: ["x", "y"] }], policies);
  assert.equal(r.bySubject.length, 1);
  assert.deepEqual(r.bySubject[0], { subjectId: "u", conflictCount: 2, worstSeverity: "critical" });
});

test("summary counts tally by severity", () => {
  const policies: SoDPolicy[] = [
    { id: "p1", label: "1", severity: "critical", a: ["x"], b: ["y"] },
    { id: "p2", label: "2", severity: "critical", a: ["x"], b: ["y"] },
    { id: "p3", label: "3", severity: "medium", a: ["x"], b: ["y"] },
  ];
  const r = findSeparationOfDutiesConflicts([{ subjectId: "u", grants: ["x", "y"] }], policies);
  assert.deepEqual(r.counts, { low: 0, medium: 1, high: 0, critical: 2 });
});

test("empty assignments or empty policies ⇒ empty result", () => {
  const empty = { conflicts: [], bySubject: [], counts: { low: 0, medium: 0, high: 0, critical: 0 } };
  assert.deepEqual(findSeparationOfDutiesConflicts([], [PAYMENTS]), empty);
  assert.deepEqual(findSeparationOfDutiesConflicts([{ subjectId: "u", grants: ["create_payment", "approve_payment"] }], []), empty);
});

test("a policy missing either side expresses no toxic combination and yields no finding", () => {
  const bad: SoDPolicy[] = [
    { id: "no-b", label: "x", severity: "high", a: ["create_payment"], b: [] },
    { id: "no-a", label: "y", severity: "high", a: [], b: ["approve_payment"] },
  ];
  const r = findSeparationOfDutiesConflicts([{ subjectId: "u", grants: ["create_payment", "approve_payment"] }], bad);
  assert.equal(r.conflicts.length, 0);
});

test("malformed assignments and policies contribute no finding and never throw", () => {
  // Non-object / null entries and non-array grant/side fields are all tolerated (fail-closed).
  const assignments = [
    null,
    { subjectId: "u", grants: "not-an-array" },
    { subjectId: "v", grants: ["create_payment", "approve_payment"] }, // the one real conflict
  ] as unknown as SoDAssignment[];
  const policies = [
    null,
    { id: "p", label: "P", severity: "nonsense", a: null, b: ["approve_payment"] },
    PAYMENTS,
  ] as unknown as SoDPolicy[];
  const r = findSeparationOfDutiesConflicts(assignments, policies);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0]!.subjectId, "v");
  assert.equal(r.conflicts[0]!.severity, "critical");
});

test("an unrecognised severity defaults to medium", () => {
  const policy = { id: "p", label: "P", severity: "urgent", a: ["x"], b: ["y"] } as unknown as SoDPolicy;
  const r = findSeparationOfDutiesConflicts([{ subjectId: "u", grants: ["x", "y"] }], [policy]);
  assert.equal(r.conflicts[0]!.severity, "medium");
});

test("ids are coerced to strings and ordering is deterministic across runs", () => {
  const policy = { id: 7, label: 99, severity: "high", a: [1], b: [2] } as unknown as SoDPolicy;
  const assignment = { subjectId: 42, grants: [1, 2] } as unknown as SoDAssignment;
  const a = findSeparationOfDutiesConflicts([assignment], [policy]);
  const b = findSeparationOfDutiesConflicts([assignment], [policy]);
  assert.deepEqual(a, b);
  assert.equal(a.conflicts[0]!.subjectId, "42");
  assert.equal(a.conflicts[0]!.policyId, "7");
  assert.deepEqual(a.conflicts[0]!.grantsFromA, ["1"]);
  assert.deepEqual(a.conflicts[0]!.grantsFromB, ["2"]);
});
