/**
 * AUTHORIZATION-POLICY (ABAC) ENGINE — a deny-by-default attribute-based access evaluator (IAM assessment gap
 * S1). The platform's coarse role ladder (rbac.ts) gates routes; this adds the fine-grained, condition-based
 * layer enterprise buyers expect — "allow a manager to edit an issue ONLY when they own it and it isn't locked"
 * — expressed as ordered policies over a flattened attribute context.
 *
 * It reuses the platform's existing predicate engine ({@link matches} / {@link ConditionSet}) for every
 * comparison, so authorization conditions speak the SAME vocabulary as automation rules, ruleset governance and
 * stage-gate criteria — this module adds NO new comparison logic, only the allow/deny resolution around it.
 *
 * Semantics — fail-closed by construction:
 *   • DENY BY DEFAULT — no matching policy ⇒ deny.
 *   • A policy matches when its action selector, its resourceType selector, AND its `when` condition all match
 *     (an absent selector/condition = no constraint = matches anything).
 *   • DENY WINS — if any matched policy denies, the decision is deny, even if others allow.
 *   • NEVER THROWS — a null / malformed / effect-less policy contributes nothing (it cannot grant), so garbage
 *     input degrades to the safe default rather than an exception or an accidental allow.
 *
 * Pure, no I/O. Deterministic (policies evaluated in declared order; matchedPolicyIds preserve that order; no
 * Math.random). Context is a flat attribute bag the caller assembles, e.g.
 * `{ "principal.id": "u1", "principal.role": "manager", "resource.ownerId": "u1", "resource.locked": false }`.
 */
import { matches, type ConditionSet, type Context } from "./predicate";

export type PolicyEffect = "allow" | "deny";

export interface AccessPolicy {
  id: string;
  effect: PolicyEffect;
  /** Action(s) governed; absent/empty ⇒ matches any action. */
  action?: string | string[];
  /** Resource type(s) governed; absent/empty ⇒ matches any resource type. */
  resourceType?: string | string[];
  /** Attribute condition over the request context; absent ⇒ always applies. */
  when?: ConditionSet;
}

export interface AccessRequest {
  action: string;
  resourceType?: string;
  /** Flattened principal + resource + environment attributes. */
  context?: Context;
}

export interface AccessDecision {
  decision: PolicyEffect;
  /** Human-facing rationale — the driving policy, or the default-deny reason. */
  reason: string;
  /** The ids of the policies that drove the decision, in declared order (empty on default-deny). */
  matchedPolicyIds: string[];
}

/** Does a string|string[]|undefined selector admit `value`? Absent/empty ⇒ no constraint (matches). */
function selectorMatches(selector: string | string[] | undefined, value: string | undefined): boolean {
  if (selector === undefined || selector === null) return true; // no constraint
  const list = Array.isArray(selector) ? selector : [selector];
  if (list.length === 0) return true;
  if (value === undefined) return false; // constrained, but the request carries no such attribute
  return list.some((s) => String(s) === value);
}

/**
 * Evaluate one access request against an ordered policy set. Deny-by-default; deny-wins; never throws. A policy
 * whose `effect` is neither "allow" nor "deny", or which is null/not-an-object, is ignored (cannot grant).
 */
export function evaluateAccess(request: AccessRequest, policies: readonly AccessPolicy[] = []): AccessDecision {
  const action = String(request?.action ?? "");
  const resourceType = request?.resourceType === undefined ? undefined : String(request.resourceType);
  const ctx: Context = request?.context ?? {};

  const allowIds: string[] = [];
  const denyIds: string[] = [];

  for (const p of policies ?? []) {
    if (!p || typeof p !== "object") continue; // garbage entry — contributes nothing
    if (p.effect !== "allow" && p.effect !== "deny") continue; // unknown effect — cannot grant, cannot deny
    let applies = false;
    try {
      applies =
        selectorMatches(p.action, action) &&
        selectorMatches(p.resourceType, resourceType) &&
        matches(p.when, ctx); // predicate engine degrades a malformed `when` safely, never throws
    } catch {
      applies = false; // defence in depth — any unexpected error ⇒ policy simply doesn't apply
    }
    if (!applies) continue;
    (p.effect === "deny" ? denyIds : allowIds).push(String(p.id));
  }

  if (denyIds.length > 0) {
    return { decision: "deny", reason: `explicit deny by policy ${denyIds[0]}`, matchedPolicyIds: denyIds };
  }
  if (allowIds.length > 0) {
    return { decision: "allow", reason: `allowed by policy ${allowIds[0]}`, matchedPolicyIds: allowIds };
  }
  return { decision: "deny", reason: "no matching policy (deny by default)", matchedPolicyIds: [] };
}

/** Evaluate many requests against the same policy set, preserving request order. */
export function evaluateAccessBatch(requests: readonly AccessRequest[], policies: readonly AccessPolicy[] = []): AccessDecision[] {
  return requests.map((r) => evaluateAccess(r, policies));
}
