import type { Request, Response, NextFunction } from "express";
import { getSession } from "../routes/auth";
import { directoryDecision } from "./scim";
import { parseCommaSet } from "./env";
import { isDemoAuth } from "./auth-config";
import { localAdminRequiresPasskey } from "./user-directory";
import { resolveScope, type Scope } from "./scope";
import { matchApiToken } from "./api-token";

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

export const ROLES = ["guest", "viewer", "contributor", "manager", "programmeManager", "pmo", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** The linear base ladder (everyday hierarchy). `guest` is the FLOOR — below viewer — so a guest
 *  fails every `requireRole("viewer")` gate automatically (locked out of the whole app), and is only
 *  admitted by routes that explicitly gate at `requireRole("guest")` (the client-facing portal). It is
 *  never assigned from IdP claims — only minted on a scoped guest session (see `grantsForReq`). */
// `programmeManager` is a SCOPED rung above project `manager` and below the authorities — a manager whose
// reach is a whole programme (its projects), assigned by admin/PMO. Everyday work needs no step-up; only
// setting a programme-level LOCK does. The authorities (pmo/admin) imply this rung's base, so they sit above it.
const BASE_RANK = { guest: 0, viewer: 1, contributor: 2, manager: 3, programmeManager: 4 } as const;
type BaseRole = keyof typeof BASE_RANK;
/** The claim-mappable base rungs (everything except the synthetic, invite-only `guest`). */
type ClaimBaseRole = Exclude<BaseRole, "guest">;

/** The orthogonal authorities that sit above `manager` (each implies manager base). */
export const AUTHORITIES = ["pmo", "admin"] as const;
export type Authority = (typeof AUTHORITIES)[number];
const isAuthority = (r: Role): r is Authority => r === "pmo" || r === "admin";

/** A user's effective grants: a base rung + the set of authorities they hold. */
export interface Grants {
  base: BaseRole;
  authorities: Set<Authority>;
}

// Memoize each role's parsed env group set, keyed on the RAW env value so a change (tests mutate
// process.env; hot-reload) rebuilds it, but the common steady-state case doesn't re-split per auth
// check (grantsFromClaims calls this up to 5×). The returned set is read-only to callers (getRoleMap
// copies it; the claim check only `.has()`es it), so sharing the instance is safe. Same shape as
// router.ts's endpoint memo.
const envRoleCache = new Map<string, { raw: string | undefined; set: Set<string> }>();
function envRoles(key: string): Set<string> {
  const raw = process.env[key];
  const cached = envRoleCache.get(key);
  if (cached && cached.raw === raw) return cached.set;
  const set = parseCommaSet(raw);
  envRoleCache.set(key, { raw, set });
  return set;
}

/** The env var carrying each role's IdP group list. `guest` is invite-only (never claim-mapped), so
 *  it has no entry — the type excludes it. */
const ENV_KEY: Record<Exclude<Role, "guest">, string> = {
  admin: "OIDC_ADMIN_ROLES",
  pmo: "OIDC_PMO_ROLES",
  programmeManager: "OIDC_PROGRAMME_MANAGER_ROLES",
  manager: "OIDC_MANAGER_ROLES",
  contributor: "OIDC_CONTRIBUTOR_ROLES",
  viewer: "OIDC_VIEWER_ROLES",
};
/** The roles that can be assigned from an IdP claim (everything except invite-only `guest`). */
const CLAIM_ROLES = ROLES.filter((r): r is Exclude<Role, "guest"> => r !== "guest");

/**
 * Admin-editable OVERRIDE of the claim→role mapping. The env (`OIDC_*_ROLES`) is
 * always the BASE; an admin may override a role's group list at runtime via the
 * role-map editor. This can ONLY assign IdP groups to the five FIXED roles — it
 * cannot invent a role or a permission, so the hard RBAC boundary is unchanged
 * (it stays statically verifiable in code). Undefined ⇒ that role uses the env.
 */
const roleMapOverride: Partial<Record<Role, Set<string>>> = {};

/** Effective group set for a claim-mappable role: the admin override if set, else the env list. */
function rolesFor(role: Exclude<Role, "guest">): Set<string> {
  return roleMapOverride[role] ?? envRoles(ENV_KEY[role]);
}

/** The effective claim→role mapping + where each role's list comes from (excludes invite-only guest). */
export function getRoleMap(): { role: Role; claims: string[]; source: "env" | "override" }[] {
  return CLAIM_ROLES.map((role) => ({
    role,
    claims: [...rolesFor(role)],
    source: roleMapOverride[role] ? "override" : "env",
  }));
}

// One-generation undo buffer for the role-map override — the state immediately before the
// LAST setRoleMap() call, so a bad edit (e.g. a typo'd IdP group name that locks admins out
// of their own authority) can be undone in one step without an operator restart. Mirrors the
// same pattern used for the config directory (.old backup) and the rate card.
let previousRoleMapOverride: Partial<Record<Role, Set<string>>> | null = null;

function cloneOverride(o: Partial<Record<Role, Set<string>>>): Partial<Record<Role, Set<string>>> {
  const out: Partial<Record<Role, Set<string>>> = {};
  for (const role of ROLES) if (o[role]) out[role] = new Set(o[role]);
  return out;
}

/**
 * Set admin overrides for the claim→role mapping. ONLY the known fixed roles are
 * accepted (unknown keys ignored), and each value must be an array of group
 * strings (normalised lower-case). There is no way to add a role or grant a
 * permission — only to decide which IdP groups land in an existing role.
 */
export function setRoleMap(next: unknown): ReturnType<typeof getRoleMap> {
  previousRoleMapOverride = cloneOverride(roleMapOverride);
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

/**
 * Undo the most recent setRoleMap() call, restoring the override exactly as it was before.
 * One-shot: the undo buffer is cleared after use. Returns false when there's nothing to undo.
 */
export function rollbackRoleMap(): boolean {
  if (!previousRoleMapOverride) return false;
  const restore = previousRoleMapOverride;
  previousRoleMapOverride = null;
  for (const role of ROLES) delete roleMapOverride[role];
  for (const role of ROLES) if (restore[role]) roleMapOverride[role] = restore[role];
  return true;
}

/** Whether a rollback is currently available (for the admin UI to show/hide the control). */
export function canRollbackRoleMap(): boolean {
  return previousRoleMapOverride !== null;
}

/** Test-only: drop all overrides (back to pure env mapping) and clear the undo buffer. */
export function resetRoleMap(): void {
  for (const role of ROLES) delete roleMapOverride[role];
  previousRoleMapOverride = null;
}

/** Serialise the current admin override as `{ role: [groups] }` (only overridden roles) — for durable
 *  persistence in the security-state file AND cross-replica fleet-sync, so a role-map edit (crucially
 *  REVOKING a compromised IdP group's admin/pmo authority) survives a restart and propagates fleet-wide
 *  instead of living only in the RAM of the replica that served the edit. */
export function snapshotRoleMap(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const role of ROLES) if (roleMapOverride[role]) out[role] = [...roleMapOverride[role]!];
  return out;
}

/**
 * Apply a role-map override snapshot from a restore / fleet converge — the ZERO-TRUST twin of
 * `setRoleMap`: it runs the SAME validation (only the five fixed roles, values must be string arrays,
 * normalised lower-case; unknown keys / wrong types dropped) so a corrupt or hostile blob can never
 * invent a role or inject a non-string group. Unlike `setRoleMap` it does NOT touch the one-shot undo
 * buffer (a converge tick is not an operator edit) and it REPLACES the whole override set, so a role
 * whose override was cleared elsewhere is cleared here too (a revocation converges, not just additions).
 */
export function applyRoleMapSnapshot(next: unknown): void {
  const parsed: Partial<Record<Role, Set<string>>> = {};
  if (next && typeof next === "object" && !Array.isArray(next)) {
    const obj = next as Record<string, unknown>;
    for (const role of ROLES) {
      const v = obj[role];
      if (Array.isArray(v)) {
        parsed[role] = new Set(
          v.filter((x): x is string => typeof x === "string").map((s) => s.trim().toLowerCase()).filter(Boolean),
        );
      }
    }
  }
  for (const role of ROLES) delete roleMapOverride[role]; // replace wholesale so a cleared role converges
  for (const role of ROLES) if (parsed[role]) roleMapOverride[role] = parsed[role]!;
}

/** The default BASE rung for an authenticated user with no matching claim. */
function defaultBaseRole(): BaseRole {
  const d = process.env["OIDC_DEFAULT_ROLE"]?.trim().toLowerCase();
  return d === "viewer" || d === "manager" || d === "contributor" ? d : "contributor";
}

/**
 * Tamper-resistant MFA gate for pmo/admin (real SSO only — demo mode is exempt, see
 * `grantsFromClaims`). A claim placing someone in the admin/pmo IdP group is not, on
 * its own, enough to wield that authority: the session's authentication-method
 * assertion must also prove a hardware-bound, phishing-resistant credential (a
 * WebAuthn/FIDO2-family method) — not password+OTP/SMS, which are phishable/relayable.
 *
 * Sourced from the ID token's `amr` (RFC 8176: "hwk" = hardware-key possession, "swk"
 * = software-key possession — both are origin-bound public-key crypto, i.e. WebAuthn)
 * or `acr`, or SAML's configurable `SAML_ACR_ATTR`. Every IdP's exact vocabulary
 * differs, so the accepted values are configurable:
 *   OIDC_STRONG_AMR_VALUES   comma list, default "hwk,swk"
 *   OIDC_STRONG_ACR_VALUES   comma list, default "" (unset — most IdPs don't need it)
 * A claims match with no qualifying amr/acr does not drop the user to viewer — it
 * withholds only the pmo/admin authority; the base-role ladder (manager, since an
 * admin/pmo group membership already implies at least that) is unaffected.
 */
const STRONG_AMR = envValueSet("OIDC_STRONG_AMR_VALUES", ["hwk", "swk"]);
const STRONG_ACR = envValueSet("OIDC_STRONG_ACR_VALUES", []);

function envValueSet(key: string, fallback: string[]): Set<string> {
  return parseCommaSet(process.env[key], fallback);
}

/** Does this session's auth-method assertion prove tamper-resistant (hardware-bound) MFA? */
export function hasStrongAuth(session: { amr?: string[] | undefined; acr?: string | undefined } | null | undefined): boolean {
  if (!session) return false;
  if ((session.amr ?? []).some((a) => STRONG_AMR.has(a.toLowerCase()))) return true;
  if (session.acr && STRONG_ACR.has(session.acr.toLowerCase())) return true;
  return false;
}

/**
 * Pure mapping from a user's raw claim groups to their GRANTS (base rung + the set
 * of authorities), using the configured role lists. Side-effect free apart from
 * reading env/overrides, so it is unit-testable without an Express request.
 */
export function grantsFromClaims(claimRoles: string[], opts: { isDemo: boolean; strongAuth?: boolean }): Grants {
  // Demo (no IdP) holds every grant so the product is fully usable out of the box —
  // there's no real identity to phish in the first place, and this posture is already
  // surfaced/warned about elsewhere (deployment-profile's demoAuthSeverity).
  if (opts.isDemo) return { base: "programmeManager", authorities: new Set(AUTHORITIES) };

  const claims = new Set(claimRoles.map((r) => r.toLowerCase()));
  const hit = (role: Exclude<Role, "guest">) => [...claims].some((c) => rolesFor(role).has(c));

  // Authorities are independent flags (union of whatever the claims match)…
  const claimedAuthorities = new Set<Authority>(AUTHORITIES.filter(hit));
  // …but a claimed pmo/admin authority is only actually GRANTED with proof of strong
  // auth. `opts.strongAuth` defaults to true (undefined) so existing callers that don't
  // pass it (e.g. tests exercising the base ladder) are unaffected.
  const authorities = opts.strongAuth === false ? new Set<Authority>() : claimedAuthorities;
  // Base rung: the highest linear role the claims match; an authority implies
  // `manager` (even when withheld above — the claim itself still proves at least
  // manager-level trust); otherwise fall back to the configured default.
  let base: BaseRole | null = null;
  for (const r of ["programmeManager", "manager", "contributor", "viewer"] as ClaimBaseRole[]) {
    if (hit(r)) { base = r; break; }
  }
  // A claimed authority implies `programmeManager` base (the claim proves programme-management-level trust,
  // and the authorities sit ABOVE that rung) — even when the authority itself is withheld for want of strong
  // auth. Take the HIGHER of the linear rung and the authority-implied rung, so e.g. a [manager + pmo] claim
  // still clears a `programmeManager` gate.
  if (claimedAuthorities.size > 0 && (!base || BASE_RANK[base] < BASE_RANK.programmeManager)) base = "programmeManager";
  if (!base) base = defaultBaseRole();
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
export function roleFromClaims(claimRoles: string[], opts: { isDemo: boolean; strongAuth?: boolean }): Role {
  return displayRole(grantsFromClaims(claimRoles, opts));
}

type Session = NonNullable<ReturnType<typeof getSession>>;

/** The request's session + its SCIM directory decision, or null when there's no session
 *  (an unauthenticated caller or a read-only API token) — the pair every per-request grant
 *  decision (`grantsForReq`, `isDeprovisioned`) starts from. */
function sessionDecision(req: Request): { session: Session; decision: ReturnType<typeof directoryDecision> } | null {
  const session = getSession(req);
  if (!session) return null;
  const decision = directoryDecision({ email: session.email, sub: session.sub });
  return { session, decision };
}

/** Resolve a request's session (or API token) to its grants. */
export function grantsForReq(req: Request): Grants {
  const sd = sessionDecision(req);
  // No session → read-only API tokens (and unauthenticated callers) are viewers.
  if (!sd) return { base: "viewer", authorities: new Set<Authority>() };
  const { session, decision } = sd;
  // A GUEST session is the invite-only floor: base `guest`, no authorities, regardless of any claims.
  // (A guest cookie carries no IdP roles anyway; this makes the intent explicit and unbypassable.)
  if (session.guest) return { base: "guest", authorities: new Set<Authority>() };
  const isDemo = isDemoAuth();
  // A SCIM-provisioned user's group memberships are merged in as extra role claims, so the
  // IdP's group→role assignment flows through without re-issuing OIDC claims.
  const claims = decision.known ? [...(session.roles ?? []), ...decision.roleClaims] : (session.roles ?? []);
  // A local (in-app password) user's password counts as strong auth for admin/PMO ONLY when the operator has
  // opted OUT of the passkey requirement (LOCAL_ADMIN_REQUIRE_PASSKEY=false). By default it does NOT, so a local
  // admin must additionally step up with a passkey — the same hardware-MFA gate every IdP admin clears.
  const strongAuth = hasStrongAuth(session) || (session.local === true && !localAdminRequiresPasskey());
  const fixed = grantsFromClaims(claims, { isDemo, strongAuth });
  // Demo already holds every grant; otherwise fold in any admin-defined custom roles the claims match (each
  // capped at its fixed base role, so this only ever equals a grant the admin could assign directly).
  if (isDemo || !customRoleGrants) return fixed;
  return unionGrants(fixed, customRoleGrants(claims, strongAuth));
}

/**
 * Resolve the request principal's DATA scope (user / programme / all). Forwarded to the backend
 * in the signed `userContext` so it can enforce per-user / per-programme access — the tier RBAC
 * gate is coarse; this is the row-level boundary. Mirrors `grantsForReq`'s claim merge (session
 * roles + SCIM group claims). No session ⇒ the most restrictive (user-level) scope.
 */
export function scopeForReq(req: Request): Scope {
  const sd = sessionDecision(req);
  if (!sd) {
    // No session ⇒ an API-token principal (or unauthenticated). A token bound to programme(s) reads only
    // that slice — every per-resource guard then enforces it — so a leaked/over-broad token (or one handed
    // to a federation peer) can't pivot across the whole portfolio. An unscoped token stays user-level.
    const apiScope = matchApiToken(req);
    if (apiScope?.programmes?.length) return { level: "programme", programmes: apiScope.programmes };
    return { level: "user" };
  }
  const { session, decision } = sd;
  // A guest is confined to exactly its one invited project — the narrowest scope.
  if (session.guest) return { level: "project", projectId: session.guest.projectId };
  const claims = decision.known ? [...(session.roles ?? []), ...decision.roleClaims] : (session.roles ?? []);
  const grants = grantsFromClaims(claims, { isDemo: isDemoAuth(), strongAuth: hasStrongAuth(session) });
  return resolveScope(grants, { sub: session.sub, groups: claims });
}

/** The merged role/group claims for a request (session roles + SCIM group claims), or [] for a guest / no
 *  session. The same claim set `grantsForReq` resolves — exposed so custom-role capability grants can be
 *  resolved from the request's groups. */
export function roleClaimsForReq(req: Request): string[] {
  const sd = sessionDecision(req);
  if (!sd) return [];
  const { session, decision } = sd;
  if (session.guest) return [];
  return decision.known ? [...(session.roles ?? []), ...decision.roleClaims] : (session.roles ?? []);
}

/** Is this request's principal DEPROVISIONED in the SCIM directory? (known + active=false.) */
export function isDeprovisioned(req: Request): boolean {
  const sd = sessionDecision(req);
  if (!sd) return false;
  return sd.decision.known && !sd.decision.active;
}

/** A representative role label for the request (display/audit only). */
export function roleForReq(req: Request): Role {
  return displayRole(grantsForReq(req));
}

/** The canonical grants for a single named role (the inverse of `displayRole`) — so a
 *  non-request principal (an autonomous actor) can be assigned grants from one role. */
export function grantsForRole(role: Role): Grants {
  if (role === "admin") return { base: "programmeManager", authorities: new Set<Authority>(["admin"]) };
  if (role === "pmo") return { base: "programmeManager", authorities: new Set<Authority>(["pmo"]) };
  if (role === "programmeManager") return { base: "programmeManager", authorities: new Set<Authority>() };
  if (role === "manager") return { base: "manager", authorities: new Set<Authority>() };
  if (role === "contributor") return { base: "contributor", authorities: new Set<Authority>() };
  if (role === "guest") return { base: "guest", authorities: new Set<Authority>() };
  return { base: "viewer", authorities: new Set<Authority>() };
}

/** Combine two grant sets: the HIGHER base rung + the UNION of authorities. */
export function unionGrants(a: Grants, b: Grants): Grants {
  return {
    base: BASE_RANK[a.base] >= BASE_RANK[b.base] ? a.base : b.base,
    authorities: new Set<Authority>([...a.authorities, ...b.authorities]),
  };
}

/**
 * Custom-role resolution SEAM. `lib/custom-roles` registers a resolver at load (claims → the union grants of
 * the matched admin-defined custom roles, each capped at its fixed base role). Kept a seam so `rbac` never
 * imports `custom-roles` — avoiding a load-time circular import — and so custom roles resolve to NOTHING when
 * the store is empty (safe default). Because each custom role is grounded in a base role an admin could grant
 * directly via the role-map, this can never confer a grant the admin couldn't already assign.
 */
export type CustomRoleGrantResolver = (claims: string[], strongAuth: boolean) => Grants;
let customRoleGrants: CustomRoleGrantResolver | null = null;
export function registerCustomRoleGrants(fn: CustomRoleGrantResolver | null): void { customRoleGrants = fn; }

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
    // Resolve the caller's grants ONCE — the allow check and the 403's "you are …" label both need
    // them (previously grantsForReq ran twice on the deny path).
    const grants = grantsForReq(req);
    if (grantsSatisfy(grants, need)) {
      next();
      return;
    }
    const what = isAuthority(need) ? `the ${need} authority` : `at least the ${need} role`;
    res.status(403).json({ error: `Requires ${what} (you are ${displayRole(grants)})` });
  };
}

/** Express middleware: require ANY of the given grants (OR gate) — e.g. the surfaces
 *  that belong to whoever owns governance (pmo) or technical config (admin), since
 *  the two authorities are orthogonal and neither alone implies the other. Else 403. */
export function requireAnyRole(...need: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Resolve grants ONCE and test each option against them (was grantsForReq per role in the OR list).
    const grants = grantsForReq(req);
    if (need.some((r) => grantsSatisfy(grants, r))) {
      next();
      return;
    }
    const what = need.map((r) => (isAuthority(r) ? `the ${r} authority` : `at least the ${r} role`)).join(" or ");
    res.status(403).json({ error: `Requires ${what} (you are ${displayRole(grants)})` });
  };
}
