import type { Request, Response, NextFunction } from "express";
import { getSession } from "../routes/auth";

/**
 * Role-based access control.
 *
 * OmniProject is a stateless overlay, so it does not own a user directory — it
 * derives a role from the OIDC token's role/group claims and enforces a coarse
 * permission gate at the gateway. The backend systems of record still enforce
 * their own authorization on every brokered write (the user's own bearer token
 * is forwarded), so this gate is defence-in-depth and UX, not the sole control.
 *
 * Roles (ascending privilege):
 *   viewer       — read only (also the role for read-only API tokens)
 *   contributor  — can create/update/delete issues
 *   manager      — contributor + RAID, baselines, portfolio actions
 *   pmo          — manager + programme/business governance (ruleset, methodology
 *                  compliance). The PMO owns the *business* rules; admin owns the
 *                  *technical* config (brokers, integrations, security, logs).
 *   admin        — everything, incl. technical settings (and, being top rank, a
 *                  superset of PMO — one person can hold both)
 *
 * `pmo` sits between `manager` and `admin`. The split is by *domain*, not just
 * privilege: PMO is the programme-management authority (business governance),
 * admin is the technical authority. Because the gate is linear, admin (top rank)
 * is a superset of PMO — an admin passes every PMO gate. To make the same person
 * a PMO *only* (not technical admin), map their IdP group to OIDC_PMO_ROLES; to
 * make them both, map to both lists (or just admin, which subsumes PMO).
 *
 * Mapping from IdP claims is configured via env (comma lists), e.g.
 *   OIDC_ADMIN_ROLES="omni-admins,platform-admins"
 *   OIDC_PMO_ROLES="pmo,programme-managers"
 *   OIDC_MANAGER_ROLES="delivery-leads"
 *   OIDC_VIEWER_ROLES="stakeholders"
 * An authenticated user with no matching claim defaults to `contributor`
 * (override with OIDC_DEFAULT_ROLE). Demo sessions are admin so the app is
 * fully usable without an IdP.
 */

export const ROLES = ["viewer", "contributor", "manager", "pmo", "admin"] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { viewer: 0, contributor: 1, manager: 2, pmo: 3, admin: 4 };

function envRoles(key: string): Set<string> {
  return new Set(
    (process.env[key] ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function defaultRole(): Role {
  const d = process.env["OIDC_DEFAULT_ROLE"]?.trim().toLowerCase();
  return (ROLES as readonly string[]).includes(d ?? "") ? (d as Role) : "contributor";
}

/**
 * Pure mapping from a user's raw claim roles to an OmniProject role, using the
 * env-configured role lists. Exported (and side-effect free apart from reading
 * env) so it can be unit-tested without an Express request.
 */
export function roleFromClaims(claimRoles: string[], opts: { isDemo: boolean }): Role {
  // Demo (no IdP) is admin so the product is fully usable out of the box.
  if (opts.isDemo) return "admin";

  const claims = new Set(claimRoles.map((r) => r.toLowerCase()));
  const hits = (set: Set<string>) => [...claims].some((c) => set.has(c));

  if (hits(envRoles("OIDC_ADMIN_ROLES"))) return "admin";
  if (hits(envRoles("OIDC_PMO_ROLES"))) return "pmo";
  if (hits(envRoles("OIDC_MANAGER_ROLES"))) return "manager";
  if (hits(envRoles("OIDC_CONTRIBUTOR_ROLES"))) return "contributor";
  if (hits(envRoles("OIDC_VIEWER_ROLES"))) return "viewer";
  return defaultRole();
}

/** Map a request's session (or API token) onto an OmniProject role. */
export function roleForReq(req: Request): Role {
  const session = getSession(req);
  if (!session) {
    // No session → read-only API tokens (and unauthenticated callers) are viewers.
    // The token's read-only enforcement happens in requireAuth; here we only need the role.
    return "viewer";
  }
  const isDemo = !process.env["OIDC_ISSUER_URL"]?.trim();
  return roleFromClaims(session.roles ?? [], { isDemo });
}

export function hasRole(req: Request, min: Role): boolean {
  return RANK[roleForReq(req)] >= RANK[min];
}

/** Express middleware: require at least `min` role, else 403. */
export function requireRole(min: Role) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (hasRole(req, min)) {
      next();
      return;
    }
    res.status(403).json({ error: `Requires ${min} role (you are ${roleForReq(req)})` });
  };
}
