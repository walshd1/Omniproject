import { randomUUID } from "node:crypto";
import { artifactStoreEnabled, listArtifacts, getArtifact, putArtifact, deleteArtifact } from "./artifact-store";
import { sanitizeText } from "./coerce";
import { hasPassword, removePassword } from "./user-credentials";

/**
 * LOCAL USER DIRECTORY — the in-app roster of native (non-IdP) users, so a deployment can manage its own
 * accounts and assign roles WITHOUT an external identity provider (while OIDC/SAML/SCIM still work alongside).
 *
 * The roster (profile + group assignment + active flag) is an ORG-scope artifact-store collection (`users`), one
 * sealed `org.json` — the same store every other org config rides. Password SECRETS never live here: they are in
 * the SEPARATELY-KEYED credential store (user-credentials). A user's ROLE flows through the SAME group→role map
 * as an IdP user: their `groups` become the session `roles` claim at login, so no new RBAC machinery is needed.
 *
 * DEMO INTERLOCK: once ≥1 active local user exists, `localUsersActive()` is true and the runtime demo gate turns
 * OFF (see auth-config) — otherwise "no IdP" would keep granting every caller admin, defeating the whole point.
 */

const USERS_ARTIFACT = "users";
const ORG = { kind: "org" as const };

/** A native user record (no secret — the password lives in the credential store, keyed by this `id`). */
export interface LocalUser {
  /** The session `sub` for this user — `local:<uuid>`. Stable, never reused. */
  id: string;
  /** The login handle (unique, case-insensitive). */
  userName: string;
  /** Display name (falls back to userName). */
  displayName: string;
  /** Optional email. */
  email: string;
  /** Group memberships → mapped to roles via the same role map as IdP claims. */
  groups: string[];
  /** Inactive users can't sign in and don't count toward the demo interlock. */
  active: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

/** The public projection (never leaks internal-only fields; there are none secret here, but keep it explicit). */
export interface LocalUserView {
  id: string;
  userName: string;
  displayName: string;
  email: string;
  groups: string[];
  active: boolean;
  /** Whether a password is set (presence only — the hash never leaves the credential store). */
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Whether the roster can persist (the org artifact store is configured). */
export function userDirectoryEnabled(): boolean {
  return artifactStoreEnabled();
}

/**
 * Policy: must a local user ALSO hold a passkey to exercise admin/PMO? The product PREFERS passkey-gated admin,
 * but that requires a passkey step-up that upgrades the session to strong auth — a capability an org opts into.
 * So the DEFAULT is off (a local password alone can hold admin, so a fresh IdP-less deployment is administrable
 * out of the box); set `LOCAL_ADMIN_REQUIRE_PASSKEY=true` to require the stronger posture. Read by rbac's
 * strong-auth step: when true, a local password session is NOT strong, so admin/PMO needs a passkey step-up
 * (or an MFA IdP), exactly like every other admin.
 */
export function localAdminRequiresPasskey(): boolean {
  const v = process.env["LOCAL_ADMIN_REQUIRE_PASSKEY"]?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function view(u: LocalUser): LocalUserView {
  return { id: u.id, userName: u.userName, displayName: u.displayName, email: u.email, groups: u.groups, active: u.active, hasPassword: hasPassword(u.id), createdAt: u.createdAt, updatedAt: u.updatedAt };
}

function rows(): LocalUser[] {
  if (!artifactStoreEnabled()) return [];
  return listArtifacts<LocalUser>(USERS_ARTIFACT, ORG);
}

/** All users (public projection), sorted by userName. */
export function listUsers(): LocalUserView[] {
  return rows().map(view).sort((a, b) => a.userName.localeCompare(b.userName));
}

/** One user by id, or null. */
export function getUser(id: string): LocalUser | null {
  return getArtifact<LocalUser>(USERS_ARTIFACT, ORG, id);
}

/** One ACTIVE user by login handle (case-insensitive), or null — the login lookup. */
export function getActiveUserByUserName(userName: string): LocalUser | null {
  const needle = userName.trim().toLowerCase();
  return rows().find((u) => u.active && u.userName.toLowerCase() === needle) ?? null;
}

/** Whether ≥1 active local user exists — the signal that turns the runtime demo gate off. */
export function localUsersActive(): boolean {
  return artifactStoreEnabled() && rows().some((u) => u.active);
}

/** Whether ANY user (active or not) exists — used by the first-run "claim first admin" bootstrap gate. */
export function anyUserExists(): boolean {
  return rows().length > 0;
}

const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A validated create payload. Throws on a bad/duplicate handle or invalid email. */
export interface CreateUserInput { userName: unknown; displayName?: unknown; email?: unknown; groups?: unknown; active?: unknown }

export class UserDirectoryError extends Error {
  constructor(message: string) { super(message); this.name = "UserDirectoryError"; }
}

/** Create a user. `userName` is required + unique (case-insensitive). Returns the public view. */
export function createUser(input: CreateUserInput, createdBy: string | null, now: string): LocalUserView {
  if (!artifactStoreEnabled()) throw new UserDirectoryError("the user directory is not configured");
  const userName = sanitizeText(input.userName, 120, { newlines: false, trim: true });
  if (!userName) throw new UserDirectoryError("userName is required");
  if (getActiveUserByUserName(userName) || rows().some((u) => u.userName.toLowerCase() === userName.toLowerCase())) {
    throw new UserDirectoryError(`userName "${userName}" is already taken`);
  }
  const email = input.email === undefined || input.email === null || input.email === "" ? "" : sanitizeText(input.email, 200, { newlines: false, trim: true });
  if (email && !EMAIL.test(email)) throw new UserDirectoryError("email is not a valid address");
  const displayName = sanitizeText(input.displayName ?? userName, 200, { newlines: false, trim: true }) || userName;
  const groups = isStrArray(input.groups) ? input.groups.map((g) => g.trim()).filter(Boolean) : [];
  const user: LocalUser = {
    id: `local:${randomUUID()}`, userName, displayName, email, groups,
    active: input.active === undefined ? true : Boolean(input.active),
    createdAt: now, updatedAt: now, createdBy,
  };
  putArtifact(USERS_ARTIFACT, ORG, user);
  return view(user);
}

/** A validated update payload (only present keys change; the id + userName are immutable here). */
export interface UpdateUserInput { displayName?: unknown; email?: unknown; groups?: unknown; active?: unknown }

/** Update a user's profile / groups / active flag. Returns the public view, or null if unknown. */
export function updateUser(id: string, patch: UpdateUserInput, now: string): LocalUserView | null {
  const existing = getUser(id);
  if (!existing) return null;
  const next: LocalUser = { ...existing, updatedAt: now };
  if (patch.displayName !== undefined) next.displayName = sanitizeText(patch.displayName, 200, { newlines: false, trim: true }) || existing.userName;
  if (patch.email !== undefined) {
    const email = patch.email === null || patch.email === "" ? "" : sanitizeText(patch.email, 200, { newlines: false, trim: true });
    if (email && !EMAIL.test(email)) throw new UserDirectoryError("email is not a valid address");
    next.email = email;
  }
  if (patch.groups !== undefined) {
    if (!isStrArray(patch.groups)) throw new UserDirectoryError("groups must be an array of strings");
    next.groups = patch.groups.map((g) => g.trim()).filter(Boolean);
  }
  if (patch.active !== undefined) next.active = Boolean(patch.active);
  putArtifact(USERS_ARTIFACT, ORG, next);
  return view(next);
}

/** Delete a user AND their credential. Returns whether one was removed. */
export function deleteUser(id: string): boolean {
  const removed = deleteArtifact(USERS_ARTIFACT, ORG, id);
  removePassword(id);
  return removed;
}

/** Public view of one user, or null. */
export function getUserView(id: string): LocalUserView | null {
  const u = getUser(id);
  return u ? view(u) : null;
}
