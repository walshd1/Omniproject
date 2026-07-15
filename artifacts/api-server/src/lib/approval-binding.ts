/**
 * Binding an ACTION to a CHAIN — the shape + validation. A binding maps an action id to a chain id; the
 * runtime resolution (`chainForAction`, `proposeIfBound`) lives in `approval-gate.ts`, kept separate so
 * THIS module stays free of a `settings` import (settings imports this validator — the split avoids a
 * module cycle). See docs/design/WORKFLOW-APPROVAL-CHAINS.md.
 */

export interface ApprovalBinding {
  /** The action id being gated (e.g. "approval.bypass", "settings.relax-dlp", a workflow-run id). */
  action: string;
  /** The `ChainDef.id` in `approvalChains` that must approve it. */
  chainId: string;
}

export class ApprovalBindingError extends Error {
  constructor(message: string) { super(message); this.name = "ApprovalBindingError"; }
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Validate + normalise the action→chain bindings (settings shape). One binding per action (a duplicate
 *  action is ambiguous). Throws {@link ApprovalBindingError} → a settings 400. */
export function validateApprovalBindings(value: unknown): ApprovalBinding[] {
  if (!Array.isArray(value)) throw new ApprovalBindingError("approvalBindings must be an array");
  const out: ApprovalBinding[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const action = str(r["action"]);
    const chainId = str(r["chainId"]);
    if (!action || !chainId) throw new ApprovalBindingError("each binding needs a non-empty action and chainId");
    if (seen.has(action)) throw new ApprovalBindingError(`action "${action}" is bound more than once`);
    seen.add(action);
    out.push({ action, chainId });
  }
  return out;
}
