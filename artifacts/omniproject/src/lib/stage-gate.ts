/**
 * Stage-gate (phase-gate) lifecycle — the configurable gated governance the enterprise suites
 * (Sciforma, Clarity) run: a project advances through ordered gates, each with entry criteria + a
 * required number of review-board approvals, and each gate ends in a go / kill / hold decision. This
 * is the pure state machine + guards; per the stateless overlay the *state* is brokered to the
 * backend, but the transition rules (can't pass a gate until its criteria are met AND it has the
 * required go-approvals; a kill is terminal; a hold stays) hold identically wherever they run.
 */

/** A gate definition: entry criteria + how many board "go" votes it needs to pass. */
export interface PhaseGate {
  id: string;
  name: string;
  criteria: { id: string; label: string }[];
  /** Minimum number of distinct "go" approvals required to pass (default 1). */
  minApprovals?: number;
}

export type Lifecycle = PhaseGate[];

export type GateVerdict = "go" | "kill" | "hold";

/** A board member's vote at a gate. */
export interface Approval {
  by: string;
  verdict: GateVerdict;
}

export type ProjectGateStatus = "in-progress" | "completed" | "killed";

/** A project's position in the lifecycle + the decision history. */
export interface GateState {
  /** Index of the gate the project is currently AT (0-based); === lifecycle.length when completed. */
  currentGateIndex: number;
  status: ProjectGateStatus;
  history: { gateId: string; verdict: GateVerdict; by: string; at: string; note?: string }[];
}

export class StageGateError extends Error {}

/** The starting state: at the first gate, in progress. */
export function initialGateState(): GateState {
  return { currentGateIndex: 0, status: "in-progress", history: [] };
}

/** Are all of a gate's criteria in the met set? */
export function criteriaMet(gate: PhaseGate, metCriterionIds: readonly string[]): boolean {
  const met = new Set(metCriterionIds);
  return gate.criteria.every((c) => met.has(c.id));
}

/** Count of DISTINCT reviewers who voted "go" (a reviewer's latest vote counts once). */
export function goApprovals(approvals: readonly Approval[]): number {
  const goers = new Set(approvals.filter((a) => a.verdict === "go").map((a) => a.by));
  return goers.size;
}

/** Is the gate ready to PASS — criteria met and enough go-approvals? */
export function canPassGate(gate: PhaseGate, metCriterionIds: readonly string[], approvals: readonly Approval[]): boolean {
  return criteriaMet(gate, metCriterionIds) && goApprovals(approvals) >= (gate.minApprovals ?? 1);
}

export interface GateDecision {
  by: string;
  verdict: GateVerdict;
  at: string;
  note?: string;
  /** Criterion ids satisfied at this gate (checked when verdict is "go"). */
  metCriterionIds?: readonly string[];
  /** The board's votes (checked for the go-approval threshold when verdict is "go"). */
  approvals?: readonly Approval[];
}

/**
 * Apply a gate decision, returning a NEW state (pure):
 *  - go: only if the current gate can pass (criteria + approvals); advances to the next gate, or
 *    completes the project after the last gate;
 *  - kill: terminal — the project is killed at the current gate;
 *  - hold: recorded, project stays at the gate.
 * Throws `StageGateError` on a decision for an already-finished project or a premature "go".
 */
export function decideGate(state: GateState, lifecycle: Lifecycle, decision: GateDecision): GateState {
  if (state.status !== "in-progress") throw new StageGateError(`project is ${state.status} — no further gate decisions`);
  const gate = lifecycle[state.currentGateIndex];
  if (!gate) throw new StageGateError("no gate at the current index");
  const entry = { gateId: gate.id, verdict: decision.verdict, by: decision.by, at: decision.at, ...(decision.note ? { note: decision.note } : {}) };
  const history = [...state.history, entry];

  if (decision.verdict === "kill") return { ...state, status: "killed", history };
  if (decision.verdict === "hold") return { ...state, history };

  // go
  if (!canPassGate(gate, decision.metCriterionIds ?? [], decision.approvals ?? [])) {
    throw new StageGateError(`gate "${gate.name}" cannot be passed: criteria unmet or insufficient approvals`);
  }
  const nextIndex = state.currentGateIndex + 1;
  return {
    currentGateIndex: nextIndex,
    status: nextIndex >= lifecycle.length ? "completed" : "in-progress",
    history,
  };
}

/** Progress summary for a project: gates passed / total, current gate, terminal status. */
export function gateProgress(state: GateState, lifecycle: Lifecycle): {
  passed: number;
  total: number;
  currentGate: PhaseGate | null;
  status: ProjectGateStatus;
} {
  return {
    passed: Math.min(state.currentGateIndex, lifecycle.length),
    total: lifecycle.length,
    currentGate: state.status === "in-progress" ? lifecycle[state.currentGateIndex] ?? null : null,
    status: state.status,
  };
}
