import type { Request, Response, NextFunction } from "express";
import { getSession } from "../routes/auth";
import { directoryDecision } from "./scim";

/**
 * Role-based access control.
 *
 * OmniProject is a stateless overlay, so it does not own a user directory — it
 * derives a user's grants from the OIDC token's role/group claims and enforces a
 * coarse permission gate at the gateway. The backend systems of record still
 * enforce their own authorization on every brokered write (the user's own bearer
 * token is forwarded), so this gate is defence-in-depth and UX, not the sole control.
 *
 * ── A linear ladder PLUS two orthogonal authorities ────────────────────────────
 * The everyday hierarchy is a linear BASE ladder:
 *   viewer       — read only (also the role for read-only API tokens)
 *   contributor  — can create/update/delete issues; tabular import
 *   manager      — contributor + RAID, baselines, portfolio actions, field manifest
 *
 * Above `manager` sit two INDEPENDENT authorities — separate capability sets, not
 * a higher rung. Each implies `manager`-level base access, but neither implies the
 * other:
 *   pmo    — BUSINESS governance: the business ruleset + methodology reference
 *            rulesets. The programme-management authority.
 *   admin  — TECHNICAL config: brokers, integrations, security, broker-log, the
 *            role-mapping editor, raw-SQL/Mongo backends. The technical authority.
 *
 * They are orthogonal and JOINABLE: a person can hold neither, either, or both.
 *   - a pure `admin` does NOT pass a `pmo` gate (can't edit business rules), and
 *   - a pure `pmo` does NOT pass an `admin` gate (can't touch technical config);
 *   - holding BOTH grants the union (map the IdP group to both lists).
 * (An admin can always bootstrap governance for someone — including themselves —
 * via the audited role-mapping editor; the grant is then explicit, not implicit.)
 *
 * Mapping from IdP claims is configured via env (comma lists), e.g.
 *   OIDC_ADMIN_ROLES="omni-admins,platform-admins"
 *   OIDC_PMO_ROLES="pmo,programme-managers"
 *   OIDC_MANAGER_ROLES="delivery-leads"
 *   OIDC_VIEWER_ROLES="stakeholders"
 * A claim can match several lists — the grants are the UNION. An authenticated user
 * with no matching claim defaults to `contributor` (override with OIDC_DEFAULT_ROLE).
 * Demo sessions hold every grant so the app is fully usable without an IdP.
 */

export const ROLES = ["viewer", "contributor", "manager", "pmo", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** The linear base ladder (everyday hierarchy). */
const BASE_RANK = { viewer: 0, contributor: 1, manager: 2 } as const;
type BaseRole = keyof typeof BASE_RANK;
const isBaseRole = (r: Role): r is BaseRole => r in BASE_RANK;

/** The orthogonal authorities that sit above `manager` (each implies manager base). */
export const AUTHORITIES = ["pmo", "admin"] as const;
export type Authority = (typeof AUTHORITIES)[number];
const isAuthority = (r: Role): r is Authority => r === "pmo" || r === "admin";

/** A user's effective grants: a base rung + the set of authorities they hold. */
export interface Grants {
  base: BaseRole;
  authorities: Set<Authority>;
}

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

/** The default BASE rung for an authenticated user with no matching claim. */
function defaultBaseRole(): BaseRole {
  const d = process.env["OIDC_DEFAULT_ROLE"]?.trim().toLowerCase();
  return d === "viewer" || d === "manager" || d === "contributor" ? d : "contributor";
}

/**
 * Pure mapping from a user's raw claim groups to their GRANTS (base rung + the set
 * of authorities), using the configured role lists. Side-effect free apart from
 * reading env/overrides, so it is unit-testable without an Express request.
 */
export function grantsFromClaims(claimRoles: string[], opts: { isDemo: boolean }): Grants {
  // Demo (no IdP) holds every grant so the product is fully usable out of the box.
  if (opts.isDemo) return { base: "manager", authorities: new Set(AUTHORITIES) };

  const claims = new Set(claimRoles.map((r) => r.toLowerCase()));
  const hit = (role: Role) => [...claims].some((c) => rolesFor(role).has(c));

  // Authorities are independent flags (union of whatever the claims match).
  const authorities = new Set<Authority>(AUTHORITIES.filter(hit));
  // Base rung: the highest linear role the claims match; an authority implies
  // `manager`; otherwise fall back to the configured default.
  let base: BaseRole | null = null;
  for (const r of ["manager", "contributor", "viewer"] as BaseRole[]) {
    if (hit(r)) { base = r; break; }
  }
  if (!base) base = authorities.size > 0 ? "manager" : defaultBaseRole();
  return { base, authorities };
}

/** A single representative label for display/audit (highest authority, else base). */
function displayRole(g: Grants): Role {
  if (g.authorities.has("admin")) return "admin";
  if (g.authorities.has("pmo")) return "pmo";
  return g.base;
}

/**
 * Back-compat single-role view of a user's claims (the representative label).
 * Prefer `grantsFromClaims` when you need the full, orthogonal picture.
 */
export function roleFromClaims(claimRoles: string[], opts: { isDemo: boolean }): Role {
  return displayRole(grantsFromClaims(claimRoles, opts));
}

/** Resolve a request's session (or API token) to its grants. */
export function grantsForReq(req: Request): Grants {
  const session = getSession(req);
  // No session → read-only API tokens (and unauthenticated callers) are viewers.
  if (!session) return { base: "viewer", authorities: new Set<Authority>() };
  const isDemo = !process.env["OIDC_ISSUER_URL"]?.trim();
  // A SCIM-provisioned user's group memberships are merged in as extra role claims, so the
  // IdP's group→role assignment flows through without re-issuing OIDC claims.
  const decision = directoryDecision({ email: session.email, sub: session.sub });
  const claims = decision.known ? [...(session.roles ?? []), ...decision.roleClaims] : (session.roles ?? []);
  return grantsFromClaims(claims, { isDemo });
}

/** Is this request's principal DEPROVISIONED in the SCIM directory? (known + active=false.) */
export function isDeprovisioned(req: Request): boolean {
  const session = getSession(req);
  if (!session) return false;
  const decision = directoryDecision({ email: session.email, sub: session.sub });
  return decision.known && !decision.active;
}

/** A representative role label for the request (display/audit only). */
export function roleForReq(req: Request): Role {
  return displayRole(grantsForReq(req));
}

/** The canonical grants for a single named role (the inverse of `displayRole`) — so a
 *  non-request principal (an autonomous actor) can be assigned grants from one role. */
export function grantsForRole(role: Role): Grants {
  if (role === "admin") return { base: "manager", authorities: new Set<Authority>(["admin"]) };
  if (role === "pmo") return { base: "manager", authorities: new Set<Authority>(["pmo"]) };
  if (role === "manager") return { base: "manager", authorities: new Set<Authority>() };
  if (role === "contributor") return { base: "contributor", authorities: new Set<Authority>() };
  return { base: "viewer", authorities: new Set<Authority>() };
}

/**
 * Do these grants satisfy the gate `need`? (The request-free core of `hasRole`.)
 *  - a BASE role (viewer/contributor/manager) → base rung ≥ that rank (an authority
 *    confers manager-level base, so a PMO or admin clears `manager`);
 *  - an AUTHORITY (pmo/admin) → that exact authority is held. A pure admin does NOT
 *    satisfy `pmo`, and a pure PMO does NOT satisfy `admin` — they are orthogonal.
 */
export function grantsSatisfy(g: Grants, need: Role): boolean {
  if (isAuthority(need)) return g.authorities.has(need);
  return BASE_RANK[g.base] >= BASE_RANK[need as BaseRole];
}

/** Does the request satisfy the gate `need`? */
export function hasRole(req: Request, need: Role): boolean {
  return grantsSatisfy(grantsForReq(req), need);
}

/** Express middleware: require the `need` grant, else 403. */
export function requireRole(need: Role) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (hasRole(req, need)) {
      next();
      return;
    }
    const what = isAuthority(need) ? `the ${need} authority` : `at least the ${need} role`;
    res.status(403).json({ error: `Requires ${what} (you are ${roleForReq(req)})` });
  };
}

/** Express middleware: require ANY of the given grants (OR gate) — e.g. the surfaces
 *  that belong to whoever owns governance (pmo) or technical config (admin), since
 *  the two authorities are orthogonal and neither alone implies the other. Else 403. */
export function requireAnyRole(...need: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (need.some((r) => hasRole(req, r))) {
      next();
      return;
    }
    const what = need.map((r) => (isAuthority(r) ? `the ${r} authority` : `at least the ${r} role`)).join(" or ");
    res.status(403).json({ error: `Requires ${what} (you are ${roleForReq(req)})` });
  };
}
