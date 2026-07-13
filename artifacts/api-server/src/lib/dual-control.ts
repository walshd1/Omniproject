import crypto from "node:crypto";
import { sharedKv } from "./shared-state";
import { parseCsvEnv } from "./env";
import { safeParseJson } from "./safe-json";

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
 * The proposal QUEUE lives in the shared-state seam (lib/shared-state): in-process by default,
 * and Redis-backed fleet-wide when REDIS_URL is set — so a proposal raised on one replica is
 * approvable on another. The EXECUTORS stay per-replica (they're code, registered identically
 * at boot on every replica); the executor runs with the gateway's own authority on approval.
 */
const PROP_PREFIX = "dc:prop:";
const PROP_TTL_MS = 24 * 60 * 60 * 1000; // proposals are short-lived; expire stale ones
export interface Actor { sub: string; email?: string | undefined }
export interface Proposal {
  id: string;
  action: string;
  params: unknown;
  proposedBy: string;
  proposedByEmail?: string | undefined;
  proposedAt: string;
  status: "pending" | "approved" | "rejected";
  decidedBy?: string;
  decidedAt?: string;
}

type Executor = (params: unknown) => void | Promise<void>;
const executors = new Map<string, Executor>();

const keyOf = (id: string): string => `${PROP_PREFIX}${id}`;
const saveProposal = (p: Proposal): Promise<void> => sharedKv.set(keyOf(p.id), JSON.stringify(p), { ttlMs: PROP_TTL_MS });

/** Validate a proposal read from shared KV before it can drive the four-eyes check + executor. The
 *  queue lives in fleet-shared state (Redis), so a poisoned entry is untrusted input: a non-string
 *  `proposedBy` (or a resurrected `status`) could defeat the `proposedBy === actor.sub` gate or replay
 *  a decided proposal. Parse prototype-safe + require the security-load-bearing fields to be well-typed;
 *  drop anything malformed. (A validated-but-forged entry still needs a legit proposer's sub — that
 *  residual trust in the shared queue is inherent; this stops injection/type-confusion/replay.) */
function sanitizeProposal(raw: string): Proposal | undefined {
  let p: Record<string, unknown>;
  try { p = safeParseJson<Record<string, unknown>>(raw); } catch { return undefined; }
  if (!p || typeof p !== "object") return undefined;
  const str = (v: unknown): v is string => typeof v === "string";
  if (!str(p["id"]) || !str(p["action"]) || !str(p["proposedBy"]) || !str(p["proposedAt"])) return undefined;
  if (p["status"] !== "pending" && p["status"] !== "approved" && p["status"] !== "rejected") return undefined;
  return {
    id: p["id"], action: p["action"], params: p["params"], proposedBy: p["proposedBy"], proposedAt: p["proposedAt"],
    status: p["status"],
    ...(str(p["proposedByEmail"]) ? { proposedByEmail: p["proposedByEmail"] } : {}),
    ...(str(p["decidedBy"]) ? { decidedBy: p["decidedBy"] } : {}),
    ...(str(p["decidedAt"]) ? { decidedAt: p["decidedAt"] } : {}),
  };
}

async function loadProposal(id: string): Promise<Proposal | undefined> {
  const raw = await sharedKv.get(keyOf(id));
  return raw ? sanitizeProposal(raw) : undefined;
}

/** Register how an action is applied once approved (one per action id). */
export function registerExecutor(action: string, fn: Executor): void { executors.set(action, fn); }

/** The set of action ids that require dual control (from DUAL_CONTROL_ACTIONS). */
export function dualControlActions(): Set<string> {
  return new Set(parseCsvEnv("DUAL_CONTROL_ACTIONS"));
}

/** Does this action require a second approver? */
export function requiresDualControl(action: string): boolean {
  return dualControlActions().has(action);
}

/** Create a pending proposal for an action (the maker step). */
export async function propose(action: string, params: unknown, actor: Actor, now: string): Promise<Proposal> {
  const p: Proposal = {
    id: crypto.randomUUID(),
    action,
    params,
    proposedBy: actor.sub,
    proposedByEmail: actor.email,
    proposedAt: now,
    status: "pending",
  };
  await saveProposal(p);
  return p;
}

/** Pending proposals (for the admin queue). */
export async function listProposals(): Promise<Proposal[]> {
  const entries = await sharedKv.list(PROP_PREFIX);
  return entries.map((e) => sanitizeProposal(e.value)).filter((p): p is Proposal => !!p && p.status === "pending");
}

export interface DecisionResult { ok: boolean; error?: string; proposal?: Proposal }

/**
 * Approve and EXECUTE a proposal (the checker step). Enforces four-eyes: the approver must be a
 * different person from the proposer. Runs the registered executor with the proposal's params.
 */
export async function approve(id: string, actor: Actor, now: string): Promise<DecisionResult> {
  const p = await loadProposal(id);
  if (!p || p.status !== "pending") return { ok: false, error: "No such pending proposal." };
  if (p.proposedBy === actor.sub) return { ok: false, error: "Four-eyes: a different admin must approve this." };
  const exec = executors.get(p.action);
  if (!exec) return { ok: false, error: `No executor registered for "${p.action}".` };
  await exec(p.params);
  p.status = "approved";
  p.decidedBy = actor.sub;
  p.decidedAt = now;
  await saveProposal(p);
  return { ok: true, proposal: p };
}

/** Reject a pending proposal (any admin, including the proposer). */
export async function reject(id: string, actor: Actor, now: string): Promise<DecisionResult> {
  const p = await loadProposal(id);
  if (!p || p.status !== "pending") return { ok: false, error: "No such pending proposal." };
  p.status = "rejected";
  p.decidedBy = actor.sub;
  p.decidedAt = now;
  await saveProposal(p);
  return { ok: true, proposal: p };
}

/** Test-only: clear the proposal queue (executors persist). */
export async function __resetDualControl(): Promise<void> { await sharedKv.clear(PROP_PREFIX); }
