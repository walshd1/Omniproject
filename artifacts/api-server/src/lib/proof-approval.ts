import { registerApprovalExecutor } from "./approval-service";
import { getArtifact, putArtifact, type ArtifactScope } from "./artifact-store";
import { PROOF_ARTIFACT, applyDecisionByLabel } from "./proof";
import type { Proof } from "../broker/types";
import type { ProofDecision } from "@workspace/backend-catalogue";

/**
 * Binding a PROOF DECISION into the approval chain (roadmap 2.4 slice 4). A review decision
 * (approve / reject / changes-requested) is, when an admin has bound it to a chain, held for a
 * PASSKEY-SIGNED sign-off before it takes effect — making the decision auditable + non-repudiable, not a
 * soft server-stamped field. This is the workflow-run pattern (lib/workflow-run.ts): a single generic
 * `proof.decision` action + an executor that applies the held decision from `params` when the chain reaches
 * `approved`. The params (proofId + storage scope + decision + version) are hashed into the proposal's
 * content hash, so a signature is bound to that EXACT decision on that exact proof version.
 *
 * `version` is snapshotted at propose time: if a new deliverable re-opens the review before the chain
 * signs off (proof.ts bumps the version + resets to pending), the executor NO-OPs — a stale sign-off can
 * never land on newer artwork.
 */

/** The single action id every proof decision funnels through (an admin binds this → a chain in settings). */
export const PROOF_DECISION_ACTION = "proof.decision";

/** The queue payload for a held proof decision — everything the detached executor needs to apply it. */
export interface ProofDecisionParams {
  proofId: string;
  scope: ArtifactScope;
  decision: ProofDecision;
  /** The proof version this decision reviewed — the executor refuses to apply to a newer version. */
  version: number;
  /** The reviewer who requested the decision (audit label; the chain records its own signers separately). */
  by: string | null;
}

/**
 * Apply a held proof decision (the executor effect). Reads the proof from its scope and stamps the decision
 * — but only if it still exists AND its version is unchanged since the proposal was raised. Pure over the
 * artifact store (no request), so it can run when the chain approves on any replica.
 */
export function applyProofDecisionParams(raw: unknown): void {
  const p = raw as ProofDecisionParams;
  if (!p || typeof p.proofId !== "string" || !p.scope) return;
  const existing = getArtifact<Proof>(PROOF_ARTIFACT, p.scope, p.proofId);
  if (!existing) return;                                   // proof deleted before the chain signed off
  if ((existing.version ?? 1) !== p.version) return;       // a new deliverable re-opened the review → stale sign-off
  putArtifact(PROOF_ARTIFACT, p.scope, applyDecisionByLabel(existing, p.decision, p.by, new Date().toISOString()));
}

// Register the executor once, on import. routes/proofs.ts imports this module, so it's wired at boot
// wherever the `proofing` feature module loads (mirroring lib/settings-guard's import-time registration).
registerApprovalExecutor(PROOF_DECISION_ACTION, applyProofDecisionParams);
