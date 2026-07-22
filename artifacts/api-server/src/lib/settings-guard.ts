import { getSettings, updateSettings, validatePatch, type SettingsState } from "./settings";
import { relaxingKeys } from "./security-settings";
import { createProposal, registerApprovalExecutor } from "./approval-service";
import { chainForAction } from "./approval-gate";
import { sealConfig, openConfig } from "./config-crypto";
import { canonicalJson } from "./canonical-json";
import { safeParseJson } from "./safe-json";
import { productionSignals } from "./dev-mode-guard";
import { localUsersActive } from "./user-directory";
import type { ChainDef } from "./approval-chain";

/**
 * CI / contract-test escape hatch. When `OMNI_APPROVALS_AUTO_APPLY=1`, a posture-REDUCING settings change
 * applies immediately instead of raising a signed sign-off. HARD-GATED by the same production detector used
 * everywhere else (`productionSignals`): in ANY production-like deployment the flag is ignored, so it can
 * only ever relax the gate on a throwaway demo/CI instance — never a real one. The smoke broker-contract
 * job needs it to point the gateway at its mock broker (a posture reduction that would otherwise require a
 * passkey sign-off no headless CI run can produce).
 */
function approvalsAutoApply(): boolean {
  // The CI/contract-test escape hatch is inert in any real deployment. `productionSignals` is env-only and
  // runs blind to native local accounts bootstrapped at runtime (same gap the session-secret guard closes),
  // so also refuse to auto-apply once a real local principal exists — a genuine login means genuine
  // posture-reducing changes must go through the passkey sign-off, never silently.
  return (
    process.env["OMNI_APPROVALS_AUTO_APPLY"] === "1" &&
    productionSignals(process.env).length === 0 &&
    !localUsersActive()
  );
}

/**
 * The single-chokepoint enforcement of the governing invariant (§0, §6a): a settings change that REDUCES
 * the security posture doesn't apply immediately — it becomes a passkey-signed sign-off. A change that
 * only strengthens, or touches no security-relevant key, applies at once. This wraps `updateSettings` for
 * the ADMIN-facing routes; internal/seed/migration `updateSettings` calls stay direct (they aren't a human
 * security reduction).
 *
 * Signers scale with the deployment (§0): an org binds `settings.relax` to a ≥2-distinct-admin chain
 * (`approvalBindings`); with no binding it degrades to the SOLO chain — a single admin CONFIRMS + signs
 * their own reduction (allowSelfApproval), because no second person exists. Either way the reduction is
 * SIGNED, never silent.
 */

export const SETTINGS_RELAX_ACTION = "settings.relax";

/** Single-admin degrade: one admin stage the proposer may satisfy themselves (confirm + sign). Used only
 *  when no dual-control chain is bound — a solo self-hoster/SME. An org overrides it via `approvalBindings`. */
const SOLO_RELAX_CHAIN: ChainDef = {
  id: "__settings-relax-solo",
  scope: { kind: "org" },
  rejectionPolicy: "abort",
  allowSelfApproval: true,
  stages: [{ id: "confirm", approvers: [{ kind: "role", role: "admin" }], humanOnly: true }],
};

/** The property under which the SEALED patch travels in the proposal params (see below). */
const SEALED_PATCH = "__sealedPatch";

// The executor that applies an approved relaxation. The patch is SEALED at rest (config-crypto), so a
// security-reducing change carrying a SECRET (a webhook signing secret, a federation-peer PSK) never sits
// as plaintext in the shared-state queue while it waits for sign-off. The executor opens it here — only at
// apply time, in-process, under the internal key — and never in any inbox/list view. No code in the queue.
registerApprovalExecutor(SETTINGS_RELAX_ACTION, (params) => {
  const token = (params as Record<string, unknown> | null)?.[SEALED_PATCH];
  const plaintext = typeof token === "string" ? openConfig(token) : null;
  if (plaintext === null) throw new Error("sealed settings patch could not be opened (key rotated or tampered)");
  // Prototype-safe parse even though we sealed this ourselves — a settings patch key like "__proto__"
  // must never reach Object.prototype through the apply path.
  updateSettings(safeParseJson<Partial<SettingsState>>(plaintext));
});

export interface GuardedSettingsResult {
  /** True when the patch applied immediately (no security reduction). */
  applied: boolean;
  /** Present when the patch was HELD pending a signed sign-off; the security keys it would relax. */
  pending?: { proposalId: string; relaxes: string[] };
}

/**
 * Apply a settings patch under the invariant. If it relaxes any security setting, raise a signed sign-off
 * (bound dual-control chain, or the solo confirm+sign) and return `{applied:false, pending}` — the patch
 * applies via the executor only once the chain approves. Otherwise apply now and return `{applied:true}`.
 */
export async function applySettingsGuarded(patch: Record<string, unknown>, proposedBy: string): Promise<GuardedSettingsResult> {
  // Validate + normalise FIRST (throws SettingsValidationError on a bad value), so a held proposal can
  // never carry an invalid patch that only fails at executor time after everyone has signed.
  const normalized = validatePatch(patch);
  const relaxes = relaxingKeys(getSettings() as unknown as Record<string, unknown>, normalized);
  if (relaxes.length === 0) {
    updateSettings(normalized);
    return { applied: true };
  }
  // CI/contract-test escape hatch (see approvalsAutoApply) — inert in any production-like deployment.
  if (approvalsAutoApply()) {
    updateSettings(normalized);
    return { applied: true };
  }
  const def = chainForAction(SETTINGS_RELAX_ACTION) ?? SOLO_RELAX_CHAIN;
  // Seal the patch BEFORE it enters the queue — a relaxation may carry a secret, and the queue is shared
  // (fleet-wide under Redis). The `relaxes` summary (key names only, no values) is safe to return in the
  // clear so an approver knows WHAT is being weakened; the values stay sealed until the executor applies.
  const params = { [SEALED_PATCH]: sealConfig(canonicalJson(normalized)) };
  const proposalId = await createProposal({ def, action: SETTINGS_RELAX_ACTION, params, proposedBy });
  return { applied: false, pending: { proposalId, relaxes } };
}
