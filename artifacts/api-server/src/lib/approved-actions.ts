import type { Request } from "express";
import { ROLES, roleForReq, type Role } from "./rbac";
import { getSettings } from "./settings";

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
 * SCOPED approval (optional, narrows further): an approval can be pinned to a SURFACE
 * (screen id), a minimum ROLE, and/or a set of BACKENDS — the full matrix. An approval
 * with no scope is GLOBAL (approved everywhere, the default). A scoped approval is
 * fail-closed: a constrained dimension whose context value is unknown at the call site
 * is treated as "not allowed", so a narrowing can never leak into an unknown context.
 *
 * Vocabulary is the approved term list surfaced to the tools (advisory — the model is
 * asked to use it); actions are HARD-enforced (the planner filters to approved, and the
 * MCP executor refuses an unapproved action).
 *
 * This list is the SUPERSET / ceiling — the most an AI tool could ever do. The in-app
 * gates restrict FURTHER below it, per request: governance per-surface state (AI off on a
 * screen), RBAC role, and the autonomous write-scope grants. So approving an action here
 * makes it *possible*, not *always allowed*.
 */

/** A narrowing applied to an approved action. Any dimension left unset = unconstrained. */
export interface ActionScope {
  /** Screen ids the action is approved on (empty/undefined = every surface). */
  surfaces?: string[];
  /** Minimum role rank the caller must hold (undefined = any role). */
  minRole?: Role;
  /** Backend routing ids the action is approved against (empty/undefined = every backend). */
  backends?: string[];
}

/** The live context an enforcement point knows about when checking an approval. */
export interface ApprovalContext {
  surface?: string;
  role?: Role;
  backend?: string;
}

/** An approved action plus its (possibly empty) scope — the serialisable/catalogue form. */
export interface ActionApproval {
  action: string;
  scope: ActionScope;
}

/** The safe default: read-only canonical actions, approved globally (no scope). Writes are
 *  NOT approved by default. */
export const DEFAULT_APPROVED_ACTIONS: readonly string[] = [
  "list_projects", "list_issues", "project_summary", "get_portfolio_health",
  "get_capabilities", "get_notifications", "list_reports", "list_screens",
  "portfolio_copilot",
];

/** Approved action → its scope ({} = global/unconstrained). */
const actions = new Map<string, ActionScope>(DEFAULT_APPROVED_ACTIONS.map((a) => [a, {}]));
const vocab = new Set<string>();

const rank = (r: Role): number => ROLES.indexOf(r);

/** An allowlist dimension is satisfied when it's empty (unconstrained) or contains the value
 *  (fail-closed: a constrained dimension with no context value is denied). */
function listAllows(allow: string[] | undefined, value: string | undefined): boolean {
  if (!allow || allow.length === 0) return true;
  return value != null && allow.includes(value);
}

/** Build the approval context for a request: the caller's role + the active backend, and the
 *  surface when the caller knows it (omit it on channels with no SPA surface, e.g. MCP, where
 *  a surface-scoped approval is then SPA-only by fail-closed design). One place so the two
 *  enforcement points (the NL→action planner and the MCP executor) can't drift. */
export function approvalContextFromReq(req: Request, surface?: string): ApprovalContext {
  return { ...(surface ? { surface } : {}), role: roleForReq(req), backend: getSettings().backendSource };
}

/** Is this canonical action approved for the given context? An unscoped approval is allowed
 *  everywhere; a scoped one must satisfy every constrained dimension (fail-closed). */
export function isActionApproved(action: string, ctx: ApprovalContext = {}): boolean {
  const scope = actions.get(action);
  if (!scope) return false;
  if (!listAllows(scope.surfaces, ctx.surface)) return false;
  if (scope.minRole && (!ctx.role || rank(ctx.role) < rank(scope.minRole))) return false;
  if (!listAllows(scope.backends, ctx.backend)) return false;
  return true;
}

/** Normalise a raw scope object to a clean ActionScope (drop empties/invalids). */
function cleanScope(raw: unknown): ActionScope {
  const s = (raw ?? {}) as { surfaces?: unknown; minRole?: unknown; backends?: unknown };
  const scope: ActionScope = {};
  const strs = (v: unknown): string[] | undefined => {
    const arr = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
    return arr.length ? [...new Set(arr)] : undefined;
  };
  const surfaces = strs(s.surfaces); if (surfaces) scope.surfaces = surfaces;
  const backends = strs(s.backends); if (backends) scope.backends = backends;
  if (typeof s.minRole === "string" && (ROLES as readonly string[]).includes(s.minRole)) scope.minRole = s.minRole as Role;
  return scope;
}

/** Approve an action (admin extends the allowlist), optionally scoped. No scope = global. */
export function approveAction(action: string, scope?: ActionScope): void {
  if (action.trim()) actions.set(action, cleanScope(scope));
}
/** Remove an action from the allowlist (admin tightens). */
export function revokeApprovedAction(action: string): void { actions.delete(action); }
/** The approved action ids (scope-agnostic — backwards-compatible view). */
export function listApprovedActions(): string[] { return [...actions.keys()]; }
/** The approved actions with their scopes (catalogue + durable state). */
export function listApprovedActionRules(): ActionApproval[] {
  return [...actions.entries()].map(([action, scope]) => ({ action, scope }));
}
/** The scope pinned to an approved action, or undefined if not approved. */
export function actionScope(action: string): ActionScope | undefined { return actions.get(action); }

/** Approve a vocabulary term. Guards `typeof` so an untrusted non-string (from a restore / fleet
 *  converge) can't reach `.trim()` and throw. */
export function approveTerm(term: string): void { if (typeof term === "string" && term.trim()) vocab.add(term.trim()); }
/** The approved vocabulary. */
export function listApprovedVocab(): string[] { return [...vocab]; }

/** Replace the whole allowlist (an admin applies the customer-wide file). Accepts either the
 *  scoped `rules` form or the plain `actions` id list (approved globally) for back-compat. */
export function setApproved(input: { actions?: string[]; rules?: ActionApproval[]; vocab?: string[] }): void {
  // Every branch is defensive: this input arrives from the admin config route, the sealed-file
  // restore, AND the cross-replica fleet converge, so each element's TYPE is checked (Array.isArray +
  // typeof) rather than trusted — a hostile/corrupt entry is dropped, never applied to the AI ceiling.
  if (Array.isArray(input.rules)) {
    actions.clear();
    for (const r of input.rules) if (r && typeof r.action === "string" && r.action.trim()) actions.set(r.action, cleanScope(r.scope));
  } else if (Array.isArray(input.actions)) {
    actions.clear();
    for (const a of input.actions) if (typeof a === "string" && a.trim()) actions.set(a, {});
  }
  if (Array.isArray(input.vocab)) { vocab.clear(); for (const v of input.vocab) approveTerm(v as string); }
}

/** Test-only: restore the default-safe allowlist (reads approved globally, no vocab). */
export function __resetApproved(): void {
  actions.clear(); for (const a of DEFAULT_APPROVED_ACTIONS) actions.set(a, {});
  vocab.clear();
}
