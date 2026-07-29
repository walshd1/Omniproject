import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateMethodologyGates,
  resolveMethodologyGatePolicy,
  DEFAULT_METHODOLOGY_GATES,
  type ProjectGate,
  type MethodologyGatePolicy,
} from "./methodology-gates";

const prince2 = resolveMethodologyGatePolicy("prince2");

test("resolves the shipped PRINCE2 policy; unknown methodology mandates nothing", () => {
  assert.equal(prince2.methodology, "prince2");
  assert.equal(prince2.gates.length, 6); // g0..g5
  const none = resolveMethodologyGatePolicy("gtd");
  assert.deepEqual(none.gates, []);
});

test("an override policy wins over the shipped default", () => {
  const override: Record<string, MethodologyGatePolicy> = { prince2: { methodology: "prince2", gates: [{ id: "g0" }] } };
  assert.equal(resolveMethodologyGatePolicy("prince2", override).gates.length, 1);
});

test("all required gates passed ⇒ satisfied, none blocking", () => {
  const gates: ProjectGate[] = prince2.gates.map((g) => ({ id: g.id, status: "passed" }));
  const r = evaluateMethodologyGates(gates, prince2);
  assert.equal(r.satisfied, true);
  assert.deepEqual(r.blocking, []);
  assert.equal(r.summary.met, 6);
  assert.equal(r.summary.required, 6);
});

test("a waived gate clears; a pending/failed gate blocks", () => {
  const gates: ProjectGate[] = [
    { id: "g0", status: "passed" },
    { id: "g1", waived: true }, // waived clears
    { id: "g2", status: "passed" },
    { id: "g3", status: "pending" }, // blocks
    { id: "g4", status: "failed" }, // blocks
    { id: "g5", status: "passed" },
  ];
  const r = evaluateMethodologyGates(gates, prince2);
  assert.equal(r.satisfied, false);
  assert.deepEqual(r.blocking.map((b) => b.gate).sort(), ["g3", "g4"]);
  assert.equal(r.gates.find((g) => g.id === "g1")!.met, true);
  assert.equal(r.gates.find((g) => g.id === "g3")!.reason, "status:pending");
});

test("a missing gate record is a blocker (missing sorts before merely-unmet)", () => {
  const gates: ProjectGate[] = [
    { id: "g0", status: "passed" },
    { id: "g1", status: "passed" },
    { id: "g2", status: "passed" },
    { id: "g3", status: "passed" },
    { id: "g5", status: "pending" }, // present but unmet
    // g4 absent ⇒ missing
  ];
  const r = evaluateMethodologyGates(gates, prince2);
  assert.equal(r.summary.missing, 1);
  assert.equal(r.gates.find((g) => g.id === "g4")!.reason, "missing");
  // missing (g4) sorts before merely-unmet (g5)
  assert.deepEqual(r.blocking.map((b) => b.gate), ["g4", "g5"]);
});

test("reuses evaluateGate when a required gate carries criteria", () => {
  const policy: MethodologyGatePolicy = {
    methodology: "custom",
    gates: [{ id: "g0", criteria: [{ id: "budget-approved", mandatory: true, when: { all: [{ field: "budgetApproved", op: "eq", value: true }] } }] }],
  };
  const passing = evaluateMethodologyGates([{ id: "g0", context: { budgetApproved: true }, approvals: [] }], policy);
  assert.equal(passing.satisfied, true);
  const failing = evaluateMethodologyGates([{ id: "g0", context: { budgetApproved: false }, approvals: [] }], policy);
  assert.equal(failing.satisfied, false);
  assert.equal(failing.gates[0]!.decision, "failed"); // unmet mandatory criterion ⇒ evaluateGate returns failed
});

test("custom clearedBy narrows what counts as cleared (waived no longer clears)", () => {
  const policy: MethodologyGatePolicy = { methodology: "strict", gates: [{ id: "g0", clearedBy: ["passed"] }] };
  const r = evaluateMethodologyGates([{ id: "g0", waived: true }], policy);
  assert.equal(r.satisfied, false);
  assert.equal(r.gates[0]!.decision, "waived");
});

test("empty policy ⇒ vacuously satisfied; empty gates against a policy ⇒ all missing", () => {
  assert.equal(evaluateMethodologyGates([], { methodology: "x", gates: [] }).satisfied, true);
  const r = evaluateMethodologyGates([], prince2);
  assert.equal(r.satisfied, false);
  assert.equal(r.summary.missing, 6);
});

test("malformed input tolerated: non-objects dropped, ids coerced, dirty status ⇒ not cleared, never throws", () => {
  const gates = [
    null,
    42,
    { id: 0, status: "passed" }, // numeric id ⇒ "0" (won't match g*, harmless)
    { id: "g0", status: "definitely-not-a-status" }, // dirty ⇒ pending ⇒ blocks
    { id: "  ", status: "passed" }, // blank id dropped
  ] as unknown as ProjectGate[];
  const r = evaluateMethodologyGates(gates, resolveMethodologyGatePolicy("prince2"));
  assert.equal(r.gates.find((g) => g.id === "g0")!.decision, "pending");
  assert.equal(r.satisfied, false);
});

test("deterministic: same input ⇒ identical output; shipped default is frozen-shape", () => {
  const gates: ProjectGate[] = [{ id: "g0", status: "passed" }, { id: "g1", status: "pending" }];
  const a = evaluateMethodologyGates(gates, prince2);
  const b = evaluateMethodologyGates(gates, prince2);
  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(DEFAULT_METHODOLOGY_GATES), ["prince2"]);
});
