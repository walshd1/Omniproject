import crypto from "node:crypto";
import { sharedKv } from "./shared-state";
import { safeParseJson } from "./safe-json";
import { canonicalJson } from "./canonical-json";
import {
  startChain, applyDecision, activeStage, isEligible, redirectStage, bypassChain,
  type ChainDef, type ChainState, type Decision, type Actor, type ApproverRef,
} from "./approval-chain";
import {
  issueChallenge, consumeChallenge, getCredential, verifyWebAuthnAssertion, type AssertionInput,
} from "./passkey";
import { aiApprovalAuthorization } from "./responsibility-acceptance-service";

/** The action-id prefix a workflow RUN binds to (`workflow.run:<id>`) — matched here rather than imported
 *  from workflow-run to keep this module free of that dependency cycle. */
const WORKFLOW_RUN_PREFIX = /^workflow\.run:/;

/**
 * Approval SERVICE — orchestrates the pure engine (`approval-chain`) + the crypto (`passkey`) +
 * persistence + an executor registry into a working, end-to-end approval flow. A proposal binds an
 * `action` (+ params) to a chain; approvers satisfy each stage with a passkey-signed decision; when the
 * final stage approves, the registered EXECUTOR for that action runs with the gateway's authority (params
 * only travel in the queue — no code, exactly like `dual-control`, which this generalizes).
 *
 * State lives in the shared-state seam (fleet-wide under Redis). The chain DEFINITION is SNAPSHOTTED onto
 * the proposal at creation, so editing a def never mutates an in-flight proposal.
 */

const PROP_PREFIX = "ac:prop:";
const PROP_TTL_MS = 30 * 24 * 60 * 60 * 1000; // proposals persist a while; long-lived approvals are normal
const propKey = (id: string): string => `${PROP_PREFIX}${id}`;

/** WebAuthn relying-party config (approvals are signed against this domain/origin). */
const rpId = (): string => process.env["WEBAUTHN_RP_ID"]?.trim() || "localhost";
const rpOrigin = (): string => process.env["WEBAUTHN_ORIGIN"]?.trim() || `https://${rpId()}`;

export interface StoredProposal {
  def: ChainDef;
  state: ChainState;
  action: string;
  params: unknown;
  /** SHA-256 (hex) of the canonical {action, params} — binds a signature to this exact request. */
  contentHash: string;
  createdAt: string;
}

/** The registered "how to apply once approved" for an action id. Params only — never code in the queue. */
export type Executor = (params: unknown) => void | Promise<void>;
const executors = new Map<string, Executor>();
export function registerApprovalExecutor(action: string, fn: Executor): void { executors.set(action, fn); }

const contentHashOf = (action: string, params: unknown): string =>
  crypto.createHash("sha256").update(canonicalJson({ action, params })).digest("hex");

async function saveProposal(id: string, p: StoredProposal): Promise<void> {
  await sharedKv.set(propKey(id), JSON.stringify(p), { ttlMs: PROP_TTL_MS });
}
/** Load a stored proposal by id, or null when absent / structurally invalid (parse-safe). */
export async function loadProposal(id: string): Promise<StoredProposal | null> {
  const raw = await sharedKv.get(propKey(id));
  if (!raw) return null;
  try {
    const p = safeParseJson<StoredProposal>(raw);
    if (!p || typeof p !== "object" || !p.def || !p.state) return null;
    return p;
  } catch { return null; }
}

/** Raise a proposal: snapshot the chain def, start it at stage 0, persist. Returns the proposal id. */
export async function createProposal(input: { def: ChainDef; action: string; params: unknown; proposedBy: string }): Promise<string> {
  const id = crypto.randomUUID();
  const state = startChain(input.def, id, input.proposedBy);
  await saveProposal(id, { def: input.def, state, action: input.action, params: input.params, contentHash: contentHashOf(input.action, input.params), createdAt: new Date().toISOString() });
  return id;
}

/** Proposals awaiting `actor`'s decision: pending, actor eligible for the CURRENT stage, not the proposer,
 *  and hasn't already decided it. The approver's inbox. */
export async function inboxFor(actor: Actor): Promise<Array<{ id: string; action: string; stageId: string }>> {
  const entries = await sharedKv.list(PROP_PREFIX);
  const out: Array<{ id: string; action: string; stageId: string }> = [];
  for (const { key, value } of entries) {
    let p: StoredProposal | null = null;
    try { p = safeParseJson<StoredProposal>(value); } catch { continue; }
    if (!p || p.state?.status !== "pending") continue;
    const stage = activeStage(p.def, p.state);
    if (!stage) continue;
    if (actor.sub === p.state.proposedBy) continue;
    if (!isEligible(stage, actor)) continue;
    if (p.state.decisions.some((d) => d.stageId === stage.id && d.by === actor.sub)) continue;
    out.push({ id: key.slice(PROP_PREFIX.length), action: p.action, stageId: stage.id });
  }
  return out;
}

/** Issue a one-time passkey challenge for `sub` to sign the CURRENT stage of a proposal. Scoped per user
 *  so concurrent approvers each get their own challenge (no race on a single slot). */
export async function challengeForStage(proposalId: string, sub: string): Promise<{ challenge: string; rpId: string; stageId: string } | null> {
  const p = await loadProposal(proposalId);
  if (!p) return null;
  const stage = activeStage(p.def, p.state);
  if (!stage) return null;
  const challenge = await issueChallenge(`${proposalId}:${stage.id}:${sub}`, p.contentHash);
  return { challenge, rpId: rpId(), stageId: stage.id };
}

export class ApprovalServiceError extends Error {
  constructor(message: string) { super(message); this.name = "ApprovalServiceError"; }
}

/** A signed decision from the client: the passkey assertion parts + which credential produced them. */
export interface SignedDecision {
  decision: "approve" | "reject";
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}

/**
 * Submit a passkey-signed decision for the current stage. Verifies (one-time challenge → credential →
 * WebAuthn assertion) BEFORE advancing the pure engine, persists the new state, and — when the chain
 * reaches `approved` — runs the action's executor. Returns the resulting status. Throws on any auth failure.
 */
export async function submitDecision(proposalId: string, actor: Actor, signed: SignedDecision): Promise<{ status: ChainState["status"]; executed: boolean }> {
  const p = await loadProposal(proposalId);
  if (!p) throw new ApprovalServiceError("unknown proposal");
  const stage = activeStage(p.def, p.state);
  if (!stage) throw new ApprovalServiceError(`proposal is already ${p.state.status}`);

  // AI-as-approver gate (design §4.2): an AI may cast a binding APPROVAL only for a workflow run, and only
  // under a VALID, standing human responsibility acceptance (version-hash-bound + signer still current).
  // Default-DENY — absent/voided acceptance means the AI has no authority and nothing advances. (A `reject`
  // by an AI is not an authority grab, so it isn't gated; the engine's humanOnly check still applies.)
  if (actor.via === "ai" && signed.decision === "approve") {
    const workflowId = WORKFLOW_RUN_PREFIX.test(p.action) ? p.action.slice(p.action.indexOf(":") + 1) : "";
    if (!workflowId) throw new ApprovalServiceError("AI approval is only permitted for a workflow run under a signed acceptance");
    const auth = aiApprovalAuthorization(workflowId);
    if (!auth.ok) throw new ApprovalServiceError(`AI approval refused: ${auth.reason}`);
  }

  const scope = `${proposalId}:${stage.id}:${actor.sub}`;
  const clientData = safeParseJson<Record<string, unknown>>(Buffer.from(signed.clientDataJSON, "base64url").toString("utf8"));
  const presentedChallenge = String(clientData["challenge"] ?? "");
  if (!(await consumeChallenge(scope, presentedChallenge))) throw new ApprovalServiceError("challenge invalid, expired, or already used");

  const cred = await getCredential(actor.sub, signed.credentialId);
  if (!cred) throw new ApprovalServiceError("no such passkey for this user");
  const assertion: AssertionInput = {
    credential: cred, clientDataJSON: signed.clientDataJSON, authenticatorData: signed.authenticatorData,
    signature: signed.signature, expectedChallenge: presentedChallenge, rpId: rpId(), origin: rpOrigin(),
  };
  const { sigRef } = verifyWebAuthnAssertion(assertion); // throws AssertionError on failure

  const d: Decision = { stageId: stage.id, by: actor.sub, via: actor.via, decision: signed.decision, at: new Date().toISOString(), sigRef };
  const nextState = applyDecision(p.def, p.state, d, actor); // throws on ineligibility / SoD / etc.
  await saveProposal(proposalId, { ...p, state: nextState });

  let executed = false;
  if (nextState.status === "approved") executed = await runExecutor(p.action, p.params);
  return { status: nextState.status, executed };
}

async function runExecutor(action: string, params: unknown): Promise<boolean> {
  const fn = executors.get(action);
  if (!fn) return false; // no executor registered — approval recorded, nothing to apply
  await fn(params);
  return true;
}

/** PMO REDIRECT — reassign the current stage's approvers. Authority (PMO) is checked by the caller. */
export async function redirectProposal(proposalId: string, newApprovers: ApproverRef[]): Promise<void> {
  const p = await loadProposal(proposalId);
  if (!p) throw new ApprovalServiceError("unknown proposal");
  const { def } = redirectStage(p.def, p.state, newApprovers);
  await saveProposal(proposalId, { ...p, def });
}

/**
 * PMO BYPASS — force the chain to approved and run the executor. The bypass itself is a passkey-signed PMO
 * act (verified here against a challenge over the proposal), so it is never silent. Authority is the
 * caller's to check.
 */
export async function bypassProposal(proposalId: string, pmo: Actor, signed: SignedDecision): Promise<{ executed: boolean }> {
  const p = await loadProposal(proposalId);
  if (!p) throw new ApprovalServiceError("unknown proposal");
  if (p.state.status !== "pending") throw new ApprovalServiceError(`proposal is already ${p.state.status}`);
  const scope = `${proposalId}:bypass:${pmo.sub}`;
  const clientData = safeParseJson<Record<string, unknown>>(Buffer.from(signed.clientDataJSON, "base64url").toString("utf8"));
  const presented = String(clientData["challenge"] ?? "");
  if (!(await consumeChallenge(scope, presented))) throw new ApprovalServiceError("challenge invalid, expired, or already used");
  const cred = await getCredential(pmo.sub, signed.credentialId);
  if (!cred) throw new ApprovalServiceError("no such passkey for this user");
  const { sigRef } = verifyWebAuthnAssertion({ credential: cred, clientDataJSON: signed.clientDataJSON, authenticatorData: signed.authenticatorData, signature: signed.signature, expectedChallenge: presented, rpId: rpId(), origin: rpOrigin() });
  const d: Decision = { stageId: "bypass", by: pmo.sub, via: "human", decision: "approve", at: new Date().toISOString(), sigRef };
  const nextState = bypassChain(p.state, d);
  await saveProposal(proposalId, { ...p, state: nextState });
  return { executed: await runExecutor(p.action, p.params) };
}

/** Issue a challenge for a PMO bypass of a proposal (signed like any approval, over a `:bypass` scope). */
export async function challengeForBypass(proposalId: string, sub: string): Promise<{ challenge: string; rpId: string } | null> {
  const p = await loadProposal(proposalId);
  if (!p || p.state.status !== "pending") return null;
  const challenge = await issueChallenge(`${proposalId}:bypass:${sub}`, p.contentHash);
  return { challenge, rpId: rpId() };
}
