import crypto from "node:crypto";
import { canonicalJson } from "./canonical-json";
import type { WorkflowDef } from "./workflow";

/**
 * Responsibility acceptance — the pure core (design §4.2). A workflow may be AI-approved / autonomous ONLY
 * under a standing, passkey-signed human acceptance that binds a named person to a SPECIFIC workflow version
 * (its content hash) AND to their continued presence. This module holds the version-binding primitive (the
 * content hash) and the settings-shape validator; it imports NO settings, so `settings` can import the
 * validator without a cycle (the runtime side — signing, storage, the active/void check — lives in
 * responsibility-acceptance-service.ts, mirroring approval-binding vs approval-gate).
 */

export class ResponsibilityAcceptanceError extends Error {
  constructor(message: string) { super(message); this.name = "ResponsibilityAcceptanceError"; }
}

/** A human's standing, signed acceptance of responsibility for one workflow VERSION being AI-approvable. */
export interface WorkflowAcceptance {
  /** The workflow this authorizes an AI to approve / run autonomously. */
  workflowId: string;
  /** Content hash of the EXACT accepted version — any edit to the workflow changes it, voiding this. */
  workflowHash: string;
  /** The signer (their IdP subject). */
  acceptedBy: string;
  /** The signer's email, for the request-free "is this person still current?" directory check. */
  acceptedByEmail?: string | undefined;
  /** Opaque reference to the verified passkey signature (audit trail). */
  sigRef: string;
  /** ISO timestamp the acceptance was signed. */
  acceptedAt: string;
  /** Keyed MAC over the acceptance fields under the internal key — only the signing flow (which holds the
   *  key) can mint one, so an acceptance injected via config-dir / a hand-edited settings blob carries no
   *  valid MAC and is voided at use. Absent on legacy/injected entries ⇒ treated as void. */
  mac?: string | undefined;
}

/**
 * Canonical content hash of a workflow definition. Deterministic + order-independent (canonical JSON), so
 * ANY change to the workflow's steps/actions/scope changes the hash — which voids an acceptance bound to the
 * old hash (design §4.2: "any change to the workflow or the AI's actions … the content hash no longer matches").
 */
export function workflowContentHash(def: WorkflowDef): string {
  return crypto.createHash("sha256").update(canonicalJson(def)).digest("hex");
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Validate + normalise the stored acceptance list (the settings shape). Pure — throws
 *  {@link ResponsibilityAcceptanceError}. At most one acceptance per workflow id (the newest supersedes). */
export function validateWorkflowAcceptances(value: unknown): WorkflowAcceptance[] {
  if (!Array.isArray(value)) throw new ResponsibilityAcceptanceError("workflowAcceptances must be an array");
  const seen = new Set<string>();
  return value.map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const workflowId = str(o["workflowId"]);
    const workflowHash = str(o["workflowHash"]);
    const acceptedBy = str(o["acceptedBy"]);
    const sigRef = str(o["sigRef"]);
    const acceptedAt = str(o["acceptedAt"]);
    if (!workflowId || !workflowHash || !acceptedBy || !sigRef || !acceptedAt) {
      throw new ResponsibilityAcceptanceError("each acceptance needs workflowId, workflowHash, acceptedBy, sigRef, acceptedAt");
    }
    if (seen.has(workflowId)) throw new ResponsibilityAcceptanceError(`duplicate acceptance for workflow "${workflowId}"`);
    seen.add(workflowId);
    const email = str(o["acceptedByEmail"]);
    const mac = str(o["mac"]);
    return { workflowId, workflowHash, acceptedBy, sigRef, acceptedAt, ...(email ? { acceptedByEmail: email } : {}), ...(mac ? { mac } : {}) };
  });
}
