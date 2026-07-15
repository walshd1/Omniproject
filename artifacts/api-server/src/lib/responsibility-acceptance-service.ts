import { getSettings, updateSettings } from "./settings";
import { directoryDecision } from "./scim";
import { safeParseJson } from "./safe-json";
import {
  issueChallenge, consumeChallenge, getCredential, verifyWebAuthnAssertion,
} from "./passkey";
import {
  workflowContentHash, ResponsibilityAcceptanceError, type WorkflowAcceptance,
} from "./responsibility-acceptance";

/**
 * Responsibility acceptance — the runtime side (design §4.2). Turns the pure primitives into the working
 * grant: a human passkey-signs to accept responsibility for a specific workflow VERSION being AI-approvable,
 * and the "is an AI allowed to approve this?" check is COMPUTED, never stored — an edit (content-hash
 * mismatch) or the signer's offboarding (their IdP directory entry no longer active) voids it automatically,
 * so nothing runs. No separate void job; it falls out of the checks. Imports settings/passkey/scim, so it
 * stays out of the pure module `settings` depends on.
 */

/** WebAuthn relying-party config (acceptances are signed against this domain/origin, like approvals). */
const rpId = (): string => process.env["WEBAUTHN_RP_ID"]?.trim() || "localhost";
const rpOrigin = (): string => process.env["WEBAUTHN_ORIGIN"]?.trim() || `https://${rpId()}`;
const acceptScope = (workflowId: string, sub: string): string => `wf-accept:${workflowId}:${sub}`;

/** The passkey assertion parts the client returns for a signed acceptance (no approve/reject — it's a grant). */
export interface SignedAcceptance {
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}

const workflowById = (id: string) => getSettings().workflows.find((w) => w.id === id);
const acceptances = (): WorkflowAcceptance[] => getSettings().workflowAcceptances ?? [];

/**
 * Issue a one-time challenge for `sub` to passkey-sign a responsibility acceptance for a workflow's CURRENT
 * version — the challenge is bound to that version's content hash, so a signature can't be lifted onto a
 * different (e.g. later-edited) version. Returns null for an unknown workflow.
 */
export async function challengeForAcceptance(workflowId: string, sub: string): Promise<{ challenge: string; rpId: string; workflowHash: string } | null> {
  const def = workflowById(workflowId);
  if (!def) return null;
  const workflowHash = workflowContentHash(def);
  const challenge = await issueChallenge(acceptScope(workflowId, sub), workflowHash);
  return { challenge, rpId: rpId(), workflowHash };
}

/**
 * Record a passkey-signed responsibility acceptance (a hard human-only act). Verifies the one-time challenge
 * + the WebAuthn assertion over the workflow's CURRENT content hash, then stores it (superseding any prior
 * acceptance for the same workflow). Throws {@link ResponsibilityAcceptanceError} on an unknown workflow or
 * a bad signature — the grant is never recorded without a valid signature.
 */
export async function acceptResponsibility(workflowId: string, actor: { sub: string; email?: string | undefined }, signed: SignedAcceptance): Promise<WorkflowAcceptance> {
  const def = workflowById(workflowId);
  if (!def) throw new ResponsibilityAcceptanceError("unknown workflow");
  const workflowHash = workflowContentHash(def);

  const scope = acceptScope(workflowId, actor.sub);
  const clientData = safeParseJson<Record<string, unknown>>(Buffer.from(signed.clientDataJSON, "base64url").toString("utf8"));
  const presented = String(clientData["challenge"] ?? "");
  if (!(await consumeChallenge(scope, presented))) throw new ResponsibilityAcceptanceError("challenge invalid, expired, or already used");

  const cred = await getCredential(actor.sub, signed.credentialId);
  if (!cred) throw new ResponsibilityAcceptanceError("no such passkey for this user");
  const { sigRef } = verifyWebAuthnAssertion({
    credential: cred, clientDataJSON: signed.clientDataJSON, authenticatorData: signed.authenticatorData,
    signature: signed.signature, expectedChallenge: presented, rpId: rpId(), origin: rpOrigin(),
  }); // throws AssertionError on failure

  const acceptance: WorkflowAcceptance = {
    workflowId, workflowHash, acceptedBy: actor.sub, ...(actor.email ? { acceptedByEmail: actor.email } : {}),
    sigRef, acceptedAt: new Date().toISOString(),
  };
  // One active acceptance per workflow — the fresh signature supersedes any prior one.
  const rest = acceptances().filter((a) => a.workflowId !== workflowId);
  updateSettings({ workflowAcceptances: [...rest, acceptance] });
  return acceptance;
}

/** The signer is still a CURRENT person: their IdP directory entry is active. Request-free (so it can run at
 *  AI-approval time). Unknown identity ⇒ treated as current — SCIM offboarding simply isn't wired in that
 *  deployment, and we don't invent a removal signal; a known-but-inactive user is voided. */
function signerIsCurrent(a: WorkflowAcceptance): boolean {
  const d = directoryDecision({ sub: a.acceptedBy, email: a.acceptedByEmail });
  return d.known ? d.active : true;
}

/**
 * The ACTIVE responsibility acceptance for a workflow, or null. Active = bound to the workflow's CURRENT
 * content hash (any edit voids it) AND signed by a still-current person (offboarding voids it). Computed on
 * demand — the void is implicit, never a stored flag, so it can't drift from reality.
 */
export function activeAcceptanceFor(workflowId: string): WorkflowAcceptance | null {
  const def = workflowById(workflowId);
  if (!def) return null;
  const a = acceptances().find((x) => x.workflowId === workflowId);
  if (!a) return null;
  if (a.workflowHash !== workflowContentHash(def)) return null; // workflow edited since acceptance → voided
  if (!signerIsCurrent(a)) return null;                          // signer offboarded → voided
  return a;
}

/**
 * Whether an AI may act as a (binding/sole) approver for this workflow. Default-DENY: an active acceptance
 * must exist. The deny `reason` distinguishes the recovery path for the UX — never signed, voided by an
 * edit, or voided by offboarding (all three route the scope owner to select an approver + re-sign, §4.2).
 */
export function aiApprovalAuthorization(workflowId: string): { ok: boolean; reason?: string } {
  if (activeAcceptanceFor(workflowId)) return { ok: true };
  const stored = acceptances().find((x) => x.workflowId === workflowId);
  if (!stored) return { ok: false, reason: "no responsibility acceptance — a human must review the workflow and passkey-sign before an AI may approve it" };
  const def = workflowById(workflowId);
  if (def && stored.workflowHash !== workflowContentHash(def)) {
    return { ok: false, reason: "the workflow changed since it was accepted — its scope owner must review and re-sign a fresh acceptance" };
  }
  return { ok: false, reason: "the accepting user was removed — the scope owner must select a new human approver and sign" };
}

/** List every stored acceptance with its live active/void status (for the governance UX). */
export function listAcceptances(): Array<WorkflowAcceptance & { active: boolean }> {
  return acceptances().map((a) => ({ ...a, active: activeAcceptanceFor(a.workflowId)?.acceptedAt === a.acceptedAt }));
}

/** Revoke the acceptance for a workflow (strengthens the posture → applies immediately). No-op if none. */
export function revokeAcceptance(workflowId: string): void {
  const rest = acceptances().filter((a) => a.workflowId !== workflowId);
  if (rest.length !== acceptances().length) updateSettings({ workflowAcceptances: rest });
}
