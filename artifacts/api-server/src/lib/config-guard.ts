import { readConfigCollection, writeOrgConfigCollection } from "./scoped-config";
import { relaxingConfig } from "./security-config";
import { createProposal, registerApprovalExecutor } from "./approval-service";
import { chainForAction } from "./approval-gate";
import { sealConfig, openConfig } from "./config-crypto";
import { canonicalJson } from "./canonical-json";
import { safeParseJson } from "./safe-json";
import type { ChainDef } from "./approval-chain";

/**
 * The config-def analogue of `settings-guard.ts` — the single chokepoint that enforces the governing invariant
 * (§0, §6a) for a security-classified config-def collection (roadmap Phase C). A write that REDUCES the resolved
 * security posture does NOT apply immediately: it becomes a passkey-signed sign-off, and applies via the
 * executor only once the chain approves. A strengthening/neutral write, or any write to a non-security config,
 * applies at once (that's the CHOICE path in `settings-collection-router`, which never calls this).
 *
 * This mirrors `applySettingsGuarded` exactly (seal-at-rest, solo-degrade chain, key-names-only summary) but
 * persists to a scope-layered `config` def via `writeOrgConfigCollection` instead of `updateSettings`.
 */

export const CONFIG_RELAX_ACTION = "config.relax";

/** Single-admin degrade: one admin stage the proposer may satisfy themselves (confirm + sign). Used only when
 *  no dual-control chain is bound to `config.relax` — a solo self-hoster. An org overrides via `approvalBindings`. */
const SOLO_RELAX_CHAIN: ChainDef = {
  id: "__config-relax-solo",
  scope: { kind: "org" },
  rejectionPolicy: "abort",
  allowSelfApproval: true,
  stages: [{ id: "confirm", approvers: [{ kind: "role", role: "admin" }], humanOnly: true }],
};

/** The property under which the SEALED config write travels in the proposal params. */
const SEALED_CONFIG = "__sealedConfig";

// The executor that applies an approved relaxation. The write is SEALED at rest (config-crypto), so a
// security-reducing config value (which may carry a secret — an egress url, a peer PSK) never sits as plaintext
// in the shared-state queue while it waits for sign-off. The executor opens it only at apply time, in-process,
// under the internal key — never in any inbox/list view.
registerApprovalExecutor(CONFIG_RELAX_ACTION, (params) => {
  const token = (params as Record<string, unknown> | null)?.[SEALED_CONFIG];
  const plaintext = typeof token === "string" ? openConfig(token) : null;
  if (plaintext === null) throw new Error("sealed config write could not be opened (key rotated or tampered)");
  // Prototype-safe parse even though we sealed this ourselves — a config value must never reach Object.prototype.
  const { configId, name, value } = safeParseJson<{ configId: string; name: string; value: unknown }>(plaintext);
  writeOrgConfigCollection(configId, name, value);
});

export interface GuardedConfigResult {
  /** True when the write applied immediately (no security reduction). */
  applied: boolean;
  /** Present when the write was HELD pending a signed sign-off; the config ids it would relax. */
  pending?: { proposalId: string; relaxes: string[] };
}

/**
 * Persist a security-classified config-def collection under the invariant. If the (already-validated) `value`
 * relaxes the resolved posture vs the current stored value, raise a signed sign-off (bound dual-control chain,
 * or the solo confirm+sign) and return `{applied:false, pending}` — the write applies via the executor only once
 * the chain approves. Otherwise write now and return `{applied:true}`. `value` MUST already be normalised by the
 * collection's validator (the router validates before calling this), so a held proposal can't carry a bad value.
 */
export async function applyConfigCollectionGuarded(
  configId: string, name: string, value: unknown, proposedBy: string,
): Promise<GuardedConfigResult> {
  const current = readConfigCollection<unknown>(configId, null);
  if (!relaxingConfig(configId, current, value)) {
    writeOrgConfigCollection(configId, name, value);
    return { applied: true };
  }
  const def = chainForAction(CONFIG_RELAX_ACTION) ?? SOLO_RELAX_CHAIN;
  // Seal the write BEFORE it enters the queue (shared, fleet-wide). The `relaxes` summary (the config id only,
  // no values) is safe to return in the clear so an approver knows WHAT is being weakened; the value stays
  // sealed until the executor applies it.
  const params = { [SEALED_CONFIG]: sealConfig(canonicalJson({ configId, name, value })) };
  const proposalId = await createProposal({ def, action: CONFIG_RELAX_ACTION, params, proposedBy });
  return { applied: false, pending: { proposalId, relaxes: [configId] } };
}
