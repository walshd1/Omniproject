import { getSettings } from "./settings";
import { createProposal } from "./approval-service";
import type { ChainDef } from "./approval-chain";

/**
 * Runtime side of action→chain binding — resolves the bound chain from settings and raises a proposal.
 * Kept separate from `approval-binding.ts` (which `settings` imports) so this module can import `settings`
 * without a cycle. This is the single decision point every chain-gated action funnels through: bound ⇒
 * raise a proposal and DON'T execute now (the effect runs via the registered executor when the chain
 * approves); unbound ⇒ null, so the caller executes directly (off by default).
 */

/** Resolve the chain an action is bound to, or null when unbound / the bound chain id no longer exists
 *  (fail-open to direct execution: a dangling binding must not silently BLOCK an action forever). */
export function chainForAction(action: string): ChainDef | null {
  const s = getSettings();
  const binding = (s.approvalBindings ?? []).find((b) => b.action === action);
  if (!binding) return null;
  return (s.approvalChains ?? []).find((c) => c.id === binding.chainId) ?? null;
}

/**
 * If `action` is bound to a chain, raise a proposal and return its id — the caller MUST then stop and NOT
 * execute the effect now. Returns null when unbound, so the caller executes directly.
 */
export async function proposeIfBound(action: string, params: unknown, proposedBy: string): Promise<string | null> {
  const def = chainForAction(action);
  if (!def) return null;
  return createProposal({ def, action, params, proposedBy });
}
