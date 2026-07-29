/**
 * HUMAN DELEGATION GRANT — the "Alice hands Bob the approve-payment capability for two weeks, capped and
 * revocable, and every use is on the record" control that IAM assessment gap S5 calls for. When a person is
 * on leave or overloaded, another person may need to act in their stead — but a delegation is an ELEVATION,
 * so it must be time-boxed, scope-limited, use-capped, revocable and auditable, never an open-ended handover.
 *
 * This is the PURE decision core, the human analogue of the autonomous write grant (api-server's
 * autonomous-grant.ts, which gates MACHINE actors): humans normally act through their own RBAC, and this gate
 * is consulted only to let a delegatee borrow a capability they were explicitly lent. The model is
 * DEFAULT-DENY — no matching, active, in-scope, un-capped, un-revoked delegation ⇒ no access. Every delegation
 * pins exactly WHO (delegatee), WHAT (capabilities), WHERE (projects), HOW LONG (notBefore/notAfter) and HOW
 * MANY TIMES (maxUses), plus a revocation stamp; the resolver returns a single allow/deny with the first
 * failing reason so the caller (the I/O layer) can AUDIT the decision — the pure core itself does no logging.
 *
 * Pure, no I/O, DETERMINISTIC: it never calls `Date`; `now` and every timestamp are epoch-millisecond numbers
 * supplied by the caller, so a run and its test are reproducible. Validation-first and fail-closed: ids
 * coerced to strings, timestamps via optNum (absent/blank/dirty ⇒ null ⇒ that bound simply does not apply),
 * a delegation with no id or no delegatee can never match a principal and is dropped, malformed input never
 * throws, and an empty delegation set ⇒ denied.
 */
import { optNum, numLoose } from "./num";

const byStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * One human delegation record: a delegator lending a delegatee a set of capabilities, bounded in scope, time
 * and use count, and revocable. Store-maintained fields (`usesSoFar`, `revokedAt`) are validated on read.
 */
export interface HumanDelegation {
  id: string;
  /** The person granting the delegation (for provenance / audit). */
  fromSubjectId: string;
  /** The person the capability is lent TO — the only subject this delegation can authorise. */
  toSubjectId: string;
  /** Capabilities delegated (e.g. ["approve_payment"]); `["*"]` = any. Empty ⇒ grants nothing. */
  capabilities: string[];
  /** Project ids the delegation is limited to; omitted / empty / `["*"]` ⇒ any project. */
  projects?: string[];
  /** Active-from (epoch ms); omitted ⇒ active immediately. */
  notBefore?: number | null;
  /** Expiry (epoch ms); omitted ⇒ no time bound (still revocable). */
  notAfter?: number | null;
  /** Cap on how many times the delegation may be exercised; omitted ⇒ uncapped. */
  maxUses?: number | null;
  /** Uses consumed so far (store-maintained); absent ⇒ 0. */
  usesSoFar?: number | null;
  /** Revocation stamp (epoch ms); set ⇒ revoked at/after that instant. */
  revokedAt?: number | null;
}

/** A request to exercise a delegated capability. `now` is epoch ms (the engine never calls Date). */
export interface DelegationRequest {
  toSubjectId: string;
  capability: string;
  projectId?: string | null;
  now: number;
}

export interface DelegationDecision {
  allowed: boolean;
  /** The delegation that authorised the request, or null when denied. */
  delegationId: string | null;
  /** The (first) failing reason when denied; null when allowed. */
  reason: string | null;
}

/** The internal, fully-normalised shape (undefined bounds collapsed to null, scopes to arrays). */
interface CleanDelegation {
  id: string;
  fromSubjectId: string;
  toSubjectId: string;
  capabilities: string[];
  projects: string[]; // [] ⇒ any project
  notBefore: number | null;
  notAfter: number | null;
  maxUses: number | null;
  usesSoFar: number;
  revokedAt: number | null;
}

/** Coerce an unknown to a de-duped array of non-blank strings (anything non-array ⇒ []). */
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s !== "" && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Validate + normalise an untrusted delegation, or null if unusable. A delegation is an elevation, so its
 * shape is checked whenever it is read — never trusted for having come from "our" store. A record with no id
 * or no delegatee can never safely match a principal and is dropped.
 */
export function cleanDelegation(raw: unknown): CleanDelegation | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  const id = typeof g["id"] === "string" ? g["id"].trim() : "";
  const toSubjectId = typeof g["toSubjectId"] === "string" ? g["toSubjectId"].trim() : "";
  if (!id || !toSubjectId) return null;
  const fromSubjectId = typeof g["fromSubjectId"] === "string" ? g["fromSubjectId"].trim() : "";
  const uses = optNum(g["usesSoFar"]);
  return {
    id,
    fromSubjectId,
    toSubjectId,
    capabilities: toStringList(g["capabilities"]),
    projects: toStringList(g["projects"]),
    notBefore: optNum(g["notBefore"]),
    notAfter: optNum(g["notAfter"]),
    maxUses: optNum(g["maxUses"]),
    usesSoFar: uses === null ? 0 : Math.max(0, numLoose(uses)),
    revokedAt: optNum(g["revokedAt"]),
  };
}

/** Normalise a whole set, dropping malformed entries (never throws). */
function cleanAll(delegations: readonly unknown[]): CleanDelegation[] {
  if (!Array.isArray(delegations)) return [];
  const out: CleanDelegation[] = [];
  for (const d of delegations) {
    const c = cleanDelegation(d);
    if (c) out.push(c);
  }
  return out;
}

/** The pure per-record check: the first reason this delegation does NOT authorise the request, or null. */
function checkOne(d: CleanDelegation, toSubjectId: string, capability: string, projectId: string | null, now: number): string | null {
  if (d.toSubjectId !== toSubjectId) return "delegatee mismatch";
  if (d.revokedAt !== null && now >= d.revokedAt) return "delegation revoked";
  if (d.notBefore !== null && now < d.notBefore) return "delegation not yet active";
  if (d.notAfter !== null && now > d.notAfter) return "delegation expired";
  if (!d.capabilities.includes("*") && !d.capabilities.includes(capability)) return `capability "${capability}" not delegated`;
  if (projectId !== null && d.projects.length > 0 && !d.projects.includes("*") && !d.projects.includes(projectId)) return `project "${projectId}" out of scope`;
  if (d.maxUses !== null && d.usesSoFar >= d.maxUses) return "use cap reached";
  return null;
}

/**
 * DEFAULT-DENY resolver: is the delegatee authorised to exercise `capability` (optionally in `projectId`) as
 * of `now`, under any active delegation? Returns the authorising delegation id when allowed (the lowest id
 * among all that authorise, for a deterministic pick), else denied with a reason. Empty / all-malformed set ⇒
 * denied. No side effects — the caller audits the returned decision.
 */
export function resolveDelegatedAccess(delegations: readonly HumanDelegation[], req: DelegationRequest): DelegationDecision {
  const now = numLoose(req.now);
  const toSubjectId = String(req.toSubjectId);
  const capability = String(req.capability);
  const projectId = req.projectId === undefined || req.projectId === null ? null : String(req.projectId);

  const clean = cleanAll(delegations);
  const authorising = clean
    .filter((d) => checkOne(d, toSubjectId, capability, projectId, now) === null)
    .sort((a, b) => byStr(a.id, b.id));

  if (authorising.length > 0) {
    return { allowed: true, delegationId: authorising[0]!.id, reason: null };
  }
  return { allowed: false, delegationId: null, reason: "no active delegation grants this capability" };
}

/**
 * The delegations currently ACTIVE for a delegatee as of `now` (un-revoked, within any time window, not
 * use-capped-out), id-sorted — for an audit view of "what can this person currently do on someone's behalf".
 * Ignores capability/project (those are per-request); a delegation granting nothing (empty capabilities) is
 * still listed as active but will authorise no request.
 */
export function activeDelegationsFor(delegations: readonly HumanDelegation[], toSubjectId: string, now: number): HumanDelegation[] {
  const at = numLoose(now);
  const who = String(toSubjectId);
  return cleanAll(delegations)
    .filter((d) => {
      if (d.toSubjectId !== who) return false;
      if (d.revokedAt !== null && at >= d.revokedAt) return false;
      if (d.notBefore !== null && at < d.notBefore) return false;
      if (d.notAfter !== null && at > d.notAfter) return false;
      if (d.maxUses !== null && d.usesSoFar >= d.maxUses) return false;
      return true;
    })
    .sort((a, b) => byStr(a.id, b.id))
    .map((d) => ({
      id: d.id,
      fromSubjectId: d.fromSubjectId,
      toSubjectId: d.toSubjectId,
      capabilities: d.capabilities,
      projects: d.projects,
      notBefore: d.notBefore,
      notAfter: d.notAfter,
      maxUses: d.maxUses,
      usesSoFar: d.usesSoFar,
      revokedAt: d.revokedAt,
    }));
}
