import { getSettings, updateSettings, validatePatch, type SettingsState } from "./settings";
import { relaxingKeys } from "./security-settings";
import { createProposal, registerApprovalExecutor } from "./approval-service";
import { chainForAction } from "./approval-gate";
import type { ChainDef } from "./approval-chain";

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

// The executor that applies an approved relaxation — params carry the exact patch, no code in the queue.
registerApprovalExecutor(SETTINGS_RELAX_ACTION, (params) => {
  updateSettings(params as Partial<SettingsState>);
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
export async function applySettingsGuarded(patch: Partial<SettingsState>, proposedBy: string): Promise<GuardedSettingsResult> {
  // Validate + normalise FIRST (throws SettingsValidationError on a bad value), so a held proposal can
  // never carry an invalid patch that only fails at executor time after everyone has signed.
  const normalized = validatePatch(patch as Record<string, unknown>);
  const relaxes = relaxingKeys(getSettings() as unknown as Record<string, unknown>, normalized);
  if (relaxes.length === 0) {
    updateSettings(normalized);
    return { applied: true };
  }
  const def = chainForAction(SETTINGS_RELAX_ACTION) ?? SOLO_RELAX_CHAIN;
  const proposalId = await createProposal({ def, action: SETTINGS_RELAX_ACTION, params: normalized, proposedBy });
  return { applied: false, pending: { proposalId, relaxes } };
}
