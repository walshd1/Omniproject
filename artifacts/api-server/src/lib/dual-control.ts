import crypto from "node:crypto";

/**
 * Maker-checker (four-eyes) dual control for sensitive admin actions.
 *
 * When an action id is listed in DUAL_CONTROL_ACTIONS, performing it doesn't apply immediately:
 * the first admin's request creates a PROPOSAL, and a DIFFERENT admin must approve it before it
 * executes. Step-up already proves *who*; this adds a *second approver*.
 *
 * The "how to apply once approved" is a registered EXECUTOR per action id, so the proposal
 * carries only the parameters — there's no arbitrary code in the queue. Feature is off (no-op)
 * when DUAL_CONTROL_ACTIONS is empty, so a single-admin deployment is unaffected.
 *
 * HONEST SCOPE: the proposal queue is per-replica RAM (proposals are short-lived); a shared
 * store would make it global. The executor runs with the gateway's own authority on approval.
 */
export interface Actor { sub: string; email?: string }
export interface Proposal {
  id: string;
  action: string;
  params: unknown;
  proposedBy: string;
  proposedByEmail?: string;
  proposedAt: string;
  status: "pending" | "approved" | "rejected";
  decidedBy?: string;
  decidedAt?: string;
}

type Executor = (params: unknown) => void | Promise<void>;
const executors = new Map<string, Executor>();
const proposals = new Map<string, Proposal>();

/** Register how an action is applied once approved (one per action id). */
export function registerExecutor(action: string, fn: Executor): void { executors.set(action, fn); }

/** The set of action ids that require dual control (from DUAL_CONTROL_ACTIONS). */
export function dualControlActions(): Set<string> {
  return new Set((process.env["DUAL_CONTROL_ACTIONS"]?.trim() || "").split(",").map((s) => s.trim()).filter(Boolean));
}

/** Does this action require a second approver? */
export function requiresDualControl(action: string): boolean {
  return dualControlActions().has(action);
}

/** Create a pending proposal for an action (the maker step). */
export function propose(action: string, params: unknown, actor: Actor, now: string): Proposal {
  const p: Proposal = {
    id: crypto.randomUUID(),
    action,
    params,
    proposedBy: actor.sub,
    proposedByEmail: actor.email,
    proposedAt: now,
    status: "pending",
  };
  proposals.set(p.id, p);
  return p;
}

/** Pending proposals (for the admin queue). */
export function listProposals(): Proposal[] {
  return [...proposals.values()].filter((p) => p.status === "pending");
}

/** A single proposal by id. */
export function getProposal(id: string): Proposal | undefined { return proposals.get(id); }

export interface DecisionResult { ok: boolean; error?: string; proposal?: Proposal }

/**
 * Approve and EXECUTE a proposal (the checker step). Enforces four-eyes: the approver must be a
 * different person from the proposer. Runs the registered executor with the proposal's params.
 */
export async function approve(id: string, actor: Actor, now: string): Promise<DecisionResult> {
  const p = proposals.get(id);
  if (!p || p.status !== "pending") return { ok: false, error: "No such pending proposal." };
  if (p.proposedBy === actor.sub) return { ok: false, error: "Four-eyes: a different admin must approve this." };
  const exec = executors.get(p.action);
  if (!exec) return { ok: false, error: `No executor registered for "${p.action}".` };
  await exec(p.params);
  p.status = "approved";
  p.decidedBy = actor.sub;
  p.decidedAt = now;
  return { ok: true, proposal: p };
}

/** Reject a pending proposal (any admin, including the proposer). */
export function reject(id: string, actor: Actor, now: string): DecisionResult {
  const p = proposals.get(id);
  if (!p || p.status !== "pending") return { ok: false, error: "No such pending proposal." };
  p.status = "rejected";
  p.decidedBy = actor.sub;
  p.decidedAt = now;
  return { ok: true, proposal: p };
}

/** Test-only: clear the proposal queue (executors persist). */
export function __resetDualControl(): void { proposals.clear(); }
