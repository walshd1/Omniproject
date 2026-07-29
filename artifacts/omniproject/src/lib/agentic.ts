import { sendJson } from "./api";

/**
 * Supervised agentic execution (D1) — client. Submit a planned batch of low-risk actions; the gateway
 * validates it, raises ONE approval proposal a human must sign off (in the approvals inbox), and returns a
 * dry-run preview of what the approval would authorise. Nothing runs here — approval is what executes it,
 * under a just-in-time grant torn down after the run.
 */

/** One planned action. `kind` is a low-risk edit (`set-field`/`set-status`/`assign`/`add-label`) or `notify`;
 *  anything else the server rejects as propose-only. */
export interface BatchAction {
  kind: string;
  params: Record<string, unknown>;
}

export interface AgenticBatchPlan {
  scope: { kind: "org" } | { kind: "project"; projectId: string };
  actions: BatchAction[];
}

export interface BatchStepPreview {
  kind: string;
  allowed: boolean;
  reason?: string;
}

export interface ProposedBatch {
  batchId: string;
  proposalId: string;
  preview: BatchStepPreview[];
}

/** Submit a batch plan for supervised execution. Resolves to the proposal id + dry-run preview; rejects with
 *  the gateway's message on an invalid plan (400) or when supervised execution isn't enabled (409). */
export function proposeBatch(plan: AgenticBatchPlan): Promise<ProposedBatch> {
  return sendJson<ProposedBatch>("/api/agentic/batches", { plan }, "POST", "could not submit the batch");
}
