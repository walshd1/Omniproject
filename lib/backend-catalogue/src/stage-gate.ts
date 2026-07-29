/**
 * STAGE-GATE CRITERIA EVALUATION — decide whether a delivery gate should PASS, deterministically, from its
 * criteria + approvals (roadmap §4.3, "stage-gate governance with gate criteria + approvals"). The Wave-3
 * `stage_gate` record stores the *decision* (its `gateStatus` is one of pending / passed / failed / waived); this
 * engine computes what that decision SHOULD be, so a governance surface can show "3 of 4 entry criteria met, 1
 * approval outstanding — gate is PENDING" instead of a hand-set flag.
 *
 * Each criterion is a named {@link ConditionSet} over the item's measured context, evaluated by the platform's
 * existing {@link matches} predicate engine — so gate criteria speak the SAME rule vocabulary as automation rules
 * and ruleset governance, and this module adds none of its own comparison logic. Mandatory criteria gate the
 * pass; non-mandatory ones only move a (non-binding) readiness score. Approvals are tallied against a required
 * count; any rejection fails the gate outright, and an explicit governance waiver short-circuits to "waived".
 *
 * The decision maps exactly onto the `gateStatus` field vocabulary. Pure, no I/O; deterministic (criteria and
 * blockers in a fixed order — no Math.random); validation first (weights via numLoose, clamped ≥ 0; a malformed
 * condition set degrades to "matches all" inside `matches`, never throws); every divide guarded (the score is null
 * when total weight is 0).
 */
import { numLoose } from "./num";
import { matches, type ConditionSet, type Context } from "./predicate";

/** Mirrors the `stage_gate.gateStatus` enum vocabulary. */
export type GateDecision = "pending" | "passed" | "failed" | "waived";

export interface GateCriterion {
  id: string;
  label?: string;
  /** Predicate set over the item context; empty/absent ⇒ always met (matches everything). */
  when?: ConditionSet;
  /** A mandatory criterion must be met for the gate to pass; a non-mandatory one only moves the score. */
  mandatory?: boolean;
  /** Weight in the (non-binding) readiness score; coerced to a finite number ≥ 0, default 1. */
  weight?: number;
}

export interface GateApproval {
  approver: string;
  decision: "approve" | "reject" | "pending";
}

export interface GateInput {
  criteria: GateCriterion[];
  /** The item's measured values the criteria are evaluated against. */
  context?: Context;
  approvals?: GateApproval[];
  /** Minimum approvals required to clear the gate. Defaults to "every listed approver must approve". */
  requiredApprovals?: number;
  /** Explicit governance waiver — short-circuits the decision to "waived" regardless of criteria/approvals. */
  waived?: boolean;
}

export interface CriterionResult {
  id: string;
  label?: string;
  mandatory: boolean;
  met: boolean;
}

export interface GateEvaluation {
  decision: GateDecision;
  criteria: CriterionResult[];
  /** Fraction of weighted criteria met, 0–1; `null` when total weight is 0 (no criteria to score). */
  criteriaScore: number | null;
  approvals: { approved: number; rejected: number; pending: number; required: number; satisfied: boolean };
  /** Ordered, human-facing reasons the gate is not passed (empty when passed or waived). */
  blockers: string[];
}

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * Evaluate a gate. Decision precedence: an explicit waiver ⇒ "waived"; any rejection ⇒ "failed"; any unmet
 * mandatory criterion ⇒ "failed"; approvals short of the requirement ⇒ "pending"; otherwise "passed".
 */
export function evaluateGate(input: GateInput): GateEvaluation {
  const ctx: Context = input.context ?? {};
  const criteria: CriterionResult[] = input.criteria.map((c) => ({
    id: String(c.id),
    ...(c.label !== undefined ? { label: c.label } : {}),
    mandatory: c.mandatory === true,
    met: matches(c.when, ctx),
  }));

  // Weighted readiness score (non-binding): met weight / total weight, guarded when nothing carries weight.
  let metWeight = 0, totalWeight = 0;
  input.criteria.forEach((c, i) => {
    const w = Math.max(0, numLoose(c.weight ?? 1));
    totalWeight += w;
    if (criteria[i]!.met) metWeight += w;
  });
  const criteriaScore = totalWeight > 0 ? round4(metWeight / totalWeight) : null;

  const approvalsList = input.approvals ?? [];
  const approved = approvalsList.filter((a) => a.decision === "approve").length;
  const rejected = approvalsList.filter((a) => a.decision === "reject").length;
  const pending = approvalsList.filter((a) => a.decision === "pending").length;
  // Default: every listed approver must approve. An explicit count is coerced + clamped to [0, #approvals].
  const required = input.requiredApprovals === undefined
    ? approvalsList.length
    : Math.min(approvalsList.length, Math.max(0, Math.round(numLoose(input.requiredApprovals))));
  const approvalsSatisfied = rejected === 0 && approved >= required;

  const unmetMandatory = criteria.filter((c) => c.mandatory && !c.met);

  // Blockers in a fixed, deterministic order: rejections, then unmet mandatory criteria, then an approval shortfall.
  const blockers: string[] = [];
  for (const a of approvalsList) if (a.decision === "reject") blockers.push(`rejected-by:${a.approver}`);
  for (const c of unmetMandatory) blockers.push(`criterion:${c.id}`);
  if (rejected === 0 && approved < required) blockers.push(`awaiting-approvals:${required - approved}`);

  let decision: GateDecision;
  if (input.waived === true) decision = "waived";
  else if (rejected > 0) decision = "failed";
  else if (unmetMandatory.length > 0) decision = "failed";
  else if (!approvalsSatisfied) decision = "pending";
  else decision = "passed";

  return {
    decision,
    criteria,
    criteriaScore,
    approvals: { approved, rejected, pending, required, satisfied: approvalsSatisfied },
    blockers: decision === "waived" ? [] : blockers,
  };
}
