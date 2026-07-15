/**
 * Approval-chain ENGINE — the pure, deterministic state machine for an N-stage approval, generalizing
 * `dual-control` (which is the 2-party special case: one proposer + one checker). It holds NO state and
 * does NO crypto or I/O: a caller verifies each decision's signature (WebAuthn) and the actor's identity/
 * authority FIRST, then feeds a verified `Decision` in here to advance the chain. That keeps the security-
 * load-bearing logic — sequencing, eligibility, separation of duties, rejection policy, PMO overrides —
 * unit-testable in isolation, exactly like `lib/jql`.
 *
 * This module is AI-agnostic. The AI-approver rules (a signed human responsibility acceptance must exist,
 * AI may not complete a chain that requires a human, etc. — see docs/design/WORKFLOW-APPROVAL-CHAINS.md
 * §4) are a SEPARATE overlay applied by the caller BEFORE it lets an AI principal submit a decision here.
 */

/** Who may approve a stage: any holder of a role, or a specific named user. A stage lists one or more. */
export type ApproverRef = { kind: "role"; role: string } | { kind: "user"; sub: string };

/** One stage of a chain. Any ONE of `approvers` may satisfy it (quorum-per-stage is a later extension). */
export interface Stage {
  id: string;
  approvers: ApproverRef[];
  /** True when only a human may satisfy this stage (an AI decision can never complete it). Default false. */
  humanOnly?: boolean;
}

/** What a rejection does — configurable per chain (design §3). */
export type RejectionPolicy = "abort" | "send-back";

/** A chain definition (authored by PMO org-scoped / PM project-scoped; stored in org/project JSON). */
export interface ChainDef {
  id: string;
  scope: { kind: "org" } | { kind: "project"; projectId: string };
  /** Ordered — stage 0 is asked first; the chain completes when the last stage approves. */
  stages: Stage[];
  rejectionPolicy: RejectionPolicy;
  /** When true, a person who has acted on ANY earlier stage cannot act on a later one — so N stages mean
   *  N DISTINCT humans (true dual-/multi-control). Used for the privileged actions (bypass, relaxation,
   *  AI-authority grant, redirect) so no lone insider can satisfy the whole chain. Default false. */
  requireDistinctApprovers?: boolean;
}

/** A single verified decision (its signature + the actor's authority were checked by the caller). */
export interface Decision {
  stageId: string;
  by: string; // approver sub
  /** How the actor satisfied the stage — a human passkey signature, or an AI (grant-bound) key. */
  via: "human" | "ai";
  decision: "approve" | "reject";
  at: string; // ISO 8601
  /** Opaque reference to the verified signature record (kept for audit; never re-verified here). */
  sigRef: string;
}

export type ChainStatus = "pending" | "approved" | "rejected";

/** The running state of one chain instance (a proposal moving through the chain). Pure data. */
export interface ChainState {
  defId: string;
  proposalId: string;
  /** The principal that raised the proposal — can NEVER approve it (separation of duties). */
  proposedBy: string;
  status: ChainStatus;
  /** Index into `def.stages` of the stage currently awaiting a decision (when `pending`). */
  currentStage: number;
  decisions: Decision[];
}

export class ApprovalChainError extends Error {
  constructor(message: string) { super(message); this.name = "ApprovalChainError"; }
}

/** The actor attempting a decision, with the roles they hold (resolved by the caller from RBAC + scope). */
export interface Actor {
  sub: string;
  roles: readonly string[];
  via: "human" | "ai";
}

/** Open a fresh chain instance at stage 0. */
export function startChain(def: ChainDef, proposalId: string, proposedBy: string): ChainState {
  if (def.stages.length === 0) throw new ApprovalChainError("a chain needs at least one stage");
  return { defId: def.id, proposalId, proposedBy, status: "pending", currentStage: 0, decisions: [] };
}

/** Is `actor` eligible to satisfy `stage`? Matches a named user, or a role the actor holds. */
export function isEligible(stage: Stage, actor: Actor): boolean {
  return stage.approvers.some((a) =>
    a.kind === "user" ? a.sub === actor.sub : actor.roles.includes(a.role),
  );
}

/**
 * Apply a verified decision to a pending chain. Pure — returns the NEXT state, never mutates. Enforces:
 *  - the chain is still pending;
 *  - the decision targets the CURRENT stage;
 *  - the actor is eligible for that stage AND is not the proposer (separation of duties);
 *  - the actor hasn't already decided this stage;
 *  - a `humanOnly` stage cannot be completed by an AI decision.
 * On approve → advance (or mark `approved` at the last stage). On reject → `abort` (rejected) or
 * `send-back` (return to the previous stage; stage 0 send-back aborts, as there's nowhere to go back to).
 */
export function applyDecision(def: ChainDef, state: ChainState, d: Decision, actor: Actor): ChainState {
  if (state.status !== "pending") throw new ApprovalChainError(`chain is already ${state.status}`);
  const stage = def.stages[state.currentStage];
  if (!stage) throw new ApprovalChainError("chain has no current stage");
  if (d.stageId !== stage.id) throw new ApprovalChainError(`decision targets stage "${d.stageId}" but the active stage is "${stage.id}"`);
  if (actor.sub !== d.by) throw new ApprovalChainError("decision actor mismatch");
  if (actor.sub === state.proposedBy) throw new ApprovalChainError("the proposer cannot approve their own proposal");
  if (!isEligible(stage, actor)) throw new ApprovalChainError(`${actor.sub} is not an approver for stage "${stage.id}"`);
  if (state.decisions.some((x) => x.stageId === stage.id && x.by === actor.sub)) throw new ApprovalChainError("actor has already decided this stage");
  if (def.requireDistinctApprovers && state.decisions.some((x) => x.by === actor.sub)) throw new ApprovalChainError("this approver already acted on an earlier stage — distinct approvers are required");
  if (d.decision === "approve" && stage.humanOnly && actor.via !== "human") throw new ApprovalChainError(`stage "${stage.id}" requires a human approval`);

  const decisions = [...state.decisions, d];
  if (d.decision === "reject") {
    if (def.rejectionPolicy === "send-back" && state.currentStage > 0) {
      return { ...state, decisions, currentStage: state.currentStage - 1 };
    }
    return { ...state, decisions, status: "rejected" };
  }
  // approve
  const next = state.currentStage + 1;
  if (next >= def.stages.length) return { ...state, decisions, status: "approved", currentStage: state.currentStage };
  return { ...state, decisions, currentStage: next };
}

/**
 * PMO escape hatch — REDIRECT: reassign the current stage to a different approver set, without deciding it.
 * A human-only PMO act (authority checked by the caller). Recorded as a redirect entry for audit.
 */
export function redirectStage(def: ChainDef, state: ChainState, newApprovers: ApproverRef[]): { def: ChainDef; state: ChainState } {
  if (state.status !== "pending") throw new ApprovalChainError(`chain is already ${state.status}`);
  if (newApprovers.length === 0) throw new ApprovalChainError("redirect needs at least one approver");
  const stages = def.stages.map((s, i) => (i === state.currentStage ? { ...s, approvers: newApprovers } : s));
  return { def: { ...def, stages }, state };
}

/**
 * PMO escape hatch — BYPASS: override the whole chain to approved, without the remaining stages. A
 * human-only PMO act (authority + signature checked by the caller). The bypassing decision is recorded so
 * a bypass is never silent. Use sparingly — it is the documented "get out of jail" for a stuck chain.
 */
export function bypassChain(state: ChainState, d: Decision): ChainState {
  if (state.status !== "pending") throw new ApprovalChainError(`chain is already ${state.status}`);
  return { ...state, status: "approved", decisions: [...state.decisions, d] };
}

/** The stage currently awaiting a decision, or null when the chain is settled. */
export function activeStage(def: ChainDef, state: ChainState): Stage | null {
  return state.status === "pending" ? def.stages[state.currentStage] ?? null : null;
}
