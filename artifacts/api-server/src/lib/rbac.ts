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

/** The env var carrying each role's IdP group list. */
const ENV_KEY: Record<Role, string> = {
  admin: "OIDC_ADMIN_ROLES",
  pmo: "OIDC_PMO_ROLES",
  manager: "OIDC_MANAGER_ROLES",
  contributor: "OIDC_CONTRIBUTOR_ROLES",
  viewer: "OIDC_VIEWER_ROLES",
};

/**
 * Admin-editable OVERRIDE of the claim→role mapping. The env (`OIDC_*_ROLES`) is
 * always the BASE; an admin may override a role's group list at runtime via the
 * role-map editor. This can ONLY assign IdP groups to the five FIXED roles — it
 * cannot invent a role or a permission, so the hard RBAC boundary is unchanged
 * (it stays statically verifiable in code). Undefined ⇒ that role uses the env.
 */
const roleMapOverride: Partial<Record<Role, Set<string>>> = {};

/** Effective group set for a role: the admin override if set, else the env list. */
function rolesFor(role: Role): Set<string> {
  return roleMapOverride[role] ?? envRoles(ENV_KEY[role]);
}

/** The effective claim→role mapping + where each role's list comes from. */
export function getRoleMap(): { role: Role; claims: string[]; source: "env" | "override" }[] {
  return ROLES.map((role) => ({
    role,
    claims: [...rolesFor(role)],
    source: roleMapOverride[role] ? "override" : "env",
  }));
}

/**
 * Set admin overrides for the claim→role mapping. ONLY the five known roles are
 * accepted (unknown keys ignored), and each value must be an array of group
 * strings (normalised lower-case). There is no way to add a role or grant a
 * permission — only to decide which IdP groups land in an existing role.
 */
export function setRoleMap(next: unknown): ReturnType<typeof getRoleMap> {
  if (next && typeof next === "object" && !Array.isArray(next)) {
    const obj = next as Record<string, unknown>;
    for (const role of ROLES) {
      if (!(role in obj)) continue;
      const v = obj[role];
      if (Array.isArray(v)) {
        roleMapOverride[role] = new Set(
          v.filter((x): x is string => typeof x === "string").map((s) => s.trim().toLowerCase()).filter(Boolean),
        );
      }
    }
  }
  return getRoleMap();
}

/** Test-only: drop all overrides (back to pure env mapping). */
export function resetRoleMap(): void {
  for (const role of ROLES) delete roleMapOverride[role];
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

  // Highest privilege first; each role's groups come from the admin override, else env.
  if (hits(rolesFor("admin"))) return "admin";
  if (hits(rolesFor("pmo"))) return "pmo";
  if (hits(rolesFor("manager"))) return "manager";
  if (hits(rolesFor("contributor"))) return "contributor";
  if (hits(rolesFor("viewer"))) return "viewer";
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
