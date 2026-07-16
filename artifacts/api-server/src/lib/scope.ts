import type { Grants } from "./rbac";

/**
 * DATA scope — the per-principal authorization boundary the backend enforces on top of the
 * coarse RBAC tier. The gateway resolves it from the user's grants + claim/SCIM groups and
 * forwards it (verified, inside the PSK-signed broker envelope) as part of `userContext`, so
 * the system of record can confirm-and-enforce it:
 *
 *   - `all`        — pmo / admin: every project and programme.
 *   - `programme`  — a programme manager: only projects in their owned programmes. In a
 *                    "basic" (no-IdP) deployment `programmes` is empty and the backend maps
 *                    `sub → owned programmes` from its own records instead.
 *   - `user`       — a standard user: only resources they own or are a member of.
 *   - `project`    — a GUEST principal (client-facing portal): exactly ONE project, nothing else.
 *                    The narrowest scope; a guest can't even see the rest of its programme.
 *
 * This module is PURE (no request/IO) so it is the shared contract: the gateway resolves +
 * forwards it, an in-repo backend (or an external n8n one) enforces it with the same helpers.
 */

export type ScopeLevel = "user" | "programme" | "project" | "all";

export interface Scope {
  level: ScopeLevel;
  /** The owning principal (used for user-level ownership/membership checks). */
  sub?: string | undefined;
  /** The programmes this principal may act within (used for programme-level checks). */
  programmes?: string[] | undefined;
  /** The single project a `project`-level (guest) principal is confined to. */
  projectId?: string | undefined;
}

/** The group-name prefix that marks programme ownership in an IdP/SCIM group — e.g.
 *  `programme:alpha` ⇒ programme id `alpha`. Configurable per deployment. */
function programmeGroupPrefix(): string {
  return process.env["OIDC_PROGRAMME_GROUP_PREFIX"]?.trim() || "programme:";
}

/** Extract owned programme ids from a principal's claim/SCIM groups (case-insensitive). */
export function programmesFromGroups(groups: readonly string[]): string[] {
  const prefix = programmeGroupPrefix().toLowerCase();
  const out = new Set<string>();
  for (const g of groups) {
    const s = String(g).trim().toLowerCase();
    if (s.startsWith(prefix) && s.length > prefix.length) out.add(s.slice(prefix.length));
  }
  return [...out];
}

/**
 * Resolve a principal's data scope from their grants + claim groups.
 * pmo/admin ⇒ all; manager ⇒ their owned programmes; everyone else ⇒ user-level.
 */
export function resolveScope(grants: Grants, opts: { sub?: string | undefined; groups: readonly string[] }): Scope {
  if (grants.authorities.has("admin") || grants.authorities.has("pmo")) return { level: "all" };
  if (grants.base === "manager") {
    return { level: "programme", sub: opts.sub, programmes: programmesFromGroups(opts.groups) };
  }
  return { level: "user", sub: opts.sub };
}

/** A resource that can be scope-checked. Every field is optional so a backend supplies
 *  whatever it has; a non-`all` scope treats an unattributable resource as OUT of scope
 *  (fail-closed) rather than leaking it. */
export interface ScopedResource {
  /** The resource's own id — used by `project`-level (guest) scope, which is confined to one project id.
   *  Project rows already carry this, so a project-list filter matches with no extra plumbing. */
  id?: string | number | null | undefined;
  /** Legacy backend-owned programme field — retained for transition. */
  programmeId?: string | null | undefined;
  /** The GUID-registry programme membership (every programme id the resource belongs to). This is the
   *  source of truth for membership (see programmeIdsOf); the gateway resolves it before scope-checking. */
  programmeIds?: readonly string[] | undefined;
  ownerSub?: string | null | undefined;
  memberSubs?: readonly string[] | undefined;
}

/** Does `scope` permit access to resource `r`? Fail-closed for non-`all` scopes. */
export function inScope(scope: Scope, r: ScopedResource): boolean {
  if (scope.level === "all") return true;
  // A guest (project-level) sees EXACTLY its one project — matched by the resource's own id. Fail closed
  // when the id is absent (an unattributable row is never leaked to a guest).
  if (scope.level === "project") return r.id != null && String(r.id) === scope.projectId;
  if (scope.level === "programme") {
    // Membership is GUID-registry-based (programmeIds); the legacy programmeId is unioned in for a
    // clean transition. A manager sees a project iff any of its programmes is one they own.
    const owned = scope.programmes ?? [];
    if (!owned.length) return false;
    const memberOf = new Set<string>(r.programmeIds ?? []);
    if (r.programmeId != null) memberOf.add(String(r.programmeId));
    return owned.some((pg) => memberOf.has(pg));
  }
  // user-level: owned or a member.
  if (!scope.sub) return false;
  if (r.ownerSub != null && String(r.ownerSub) === scope.sub) return true;
  return (r.memberSubs ?? []).includes(scope.sub);
}

/**
 * The gateway's per-project authorization decision, factored out so the DATA-SEAM guard
 * (broker/scope-guard.ts) applies the IDENTICAL rule with no drift. Precondition: the project is
 * already known to be broker-VISIBLE to the caller (the caller found it in listProjects). Given that:
 *  - all-scope: allowed.
 *  - user-scope: allowed — a user principal's boundary IS visibility (the built-in/demo list is the
 *    scope-filtered set), matching assertProjectScope, which does NOT apply the owner/member test here.
 *  - programme-scope: additionally requires programme membership (inScope).
 * Keeping this shared means a read the gateway allowed can never be wrongly denied at the seam.
 */
export function scopeAllowsVisibleProject(scope: Scope, r: ScopedResource): boolean {
  if (scope.level === "programme") return inScope(scope, r);
  // A guest is confined to its one project — the seam allows exactly that id and nothing else.
  if (scope.level === "project") return inScope(scope, r);
  return true;
}

/** Filter a row set to those in scope (`all` ⇒ unchanged). */
export function filterInScope<T extends ScopedResource>(scope: Scope, rows: readonly T[]): T[] {
  return scope.level === "all" ? [...rows] : rows.filter((r) => inScope(scope, r));
}
