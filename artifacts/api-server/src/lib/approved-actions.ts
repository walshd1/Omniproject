/**
 * Customer-wide APPROVED vocabulary + actions.
 *
 * A single allowlist that pins exactly which canonical actions the AI tools (NL→action,
 * the MCP/agent surface) may use, plus the approved terminology they should speak. It is
 * the customer's curated "this is what AI is allowed to do here" file — narrower than the
 * full action registry — and EXTENDING it is admin-gated (a step-up-protected route).
 *
 * Default-safe: only READ actions are approved out of the box; every WRITE action must be
 * explicitly approved by an admin before any AI tool can even propose it. So a fresh
 * deployment can answer and look things up, but cannot be steered into a mutation until a
 * human has deliberately widened the allowlist.
 *
 * Vocabulary is the approved term list surfaced to the tools (advisory — the model is
 * asked to use it); actions are HARD-enforced (the planner filters to approved, and the
 * MCP executor refuses an unapproved action).
 */

/** The safe default: read-only canonical actions. Writes are NOT approved by default. */
export const DEFAULT_APPROVED_ACTIONS: readonly string[] = [
  "list_projects", "list_issues", "project_summary", "get_portfolio_health",
  "get_capabilities", "get_notifications", "list_reports", "list_screens",
];

const actions = new Set<string>(DEFAULT_APPROVED_ACTIONS);
const vocab = new Set<string>();

/** Is this canonical action on the customer's approved allowlist? */
export function isActionApproved(action: string): boolean {
  return actions.has(action);
}

/** Approve an action (admin extends the allowlist). */
export function approveAction(action: string): void { actions.add(action); }
/** Remove an action from the allowlist (admin tightens). */
export function revokeApprovedAction(action: string): void { actions.delete(action); }
/** The approved action allowlist. */
export function listApprovedActions(): string[] { return [...actions]; }

/** Approve a vocabulary term. */
export function approveTerm(term: string): void { if (term.trim()) vocab.add(term.trim()); }
/** The approved vocabulary. */
export function listApprovedVocab(): string[] { return [...vocab]; }

/** Replace the whole allowlist (an admin applies the customer-wide file). */
export function setApproved(input: { actions?: string[]; vocab?: string[] }): void {
  if (input.actions) { actions.clear(); for (const a of input.actions) actions.add(a); }
  if (input.vocab) { vocab.clear(); for (const v of input.vocab) approveTerm(v); }
}

/** Test-only: restore the default-safe allowlist (reads approved, no vocab). */
export function __resetApproved(): void {
  actions.clear(); for (const a of DEFAULT_APPROVED_ACTIONS) actions.add(a);
  vocab.clear();
}
