import crypto from "node:crypto";
import { logger } from "./logger";
import { SealedFile, resolveConfigFile } from "./sealed-file";
import { constantTimeEqual } from "./crypto-keys";

/**
 * SCIM 2.0 directory (RFC 7643/7644). OmniProject is stateless — identity is authenticated by
 * the IdP via OIDC — so SCIM doesn't own passwords or sessions. What it owns is the LIFECYCLE
 * overlay an enterprise IdP (Okta / Entra) drives:
 *
 *   - active=false (deprovision) ⇒ the user is DENIED at the gate even with a valid OIDC token;
 *   - group membership ⇒ extra role claims merged into the user's grants at request time.
 *
 * The directory is small (users + groups), held in memory and persisted SEALED (same crypto
 * as the config store) so provisioning survives a restart. It's enabled only when SCIM_TOKEN
 * is set (the bearer the IdP presents).
 */
export interface ScimEmail { value: string; primary?: boolean; type?: string }
export interface ScimUser {
  id: string;
  userName: string;
  externalId?: string | undefined;
  active: boolean;
  displayName?: string | undefined;
  emails?: ScimEmail[] | undefined;
  groups?: string[] | undefined; // group display names (role-claim-like)
  meta: { resourceType: "User"; created: string; lastModified: string };
}
export interface ScimGroup {
  id: string;
  displayName: string;
  externalId?: string | undefined;
  members: { value: string }[]; // member user ids
  meta: { resourceType: "Group"; created: string; lastModified: string };
}

interface Directory { users: Record<string, ScimUser>; groups: Record<string, ScimGroup> }
let dir: Directory = { users: {}, groups: {} };
const store = new SealedFile(() => resolveConfigFile("SCIM_STATE_FILE", "scim.json"), "scim");

/** Is SCIM provisioning enabled? (Only when a bearer token is configured.) */
export function scimEnabled(): boolean {
  return !!process.env["SCIM_TOKEN"]?.trim();
}

/** Constant-time check of a presented SCIM bearer token. */
export function scimTokenValid(presented: string | undefined): boolean {
  const expected = process.env["SCIM_TOKEN"]?.trim();
  if (!expected || !presented) return false;
  return constantTimeEqual(presented, expected);
}

function ensureLoaded(): void {
  store.loadOnce((raw) => {
    const parsed = JSON.parse(raw) as Directory;
    if (parsed.users) dir.users = parsed.users;
    if (parsed.groups) dir.groups = parsed.groups;
    logger.info({ users: Object.keys(dir.users).length, groups: Object.keys(dir.groups).length }, "scim: directory restored");
  });
}

function persist(): void {
  store.write(JSON.stringify(dir));
}

const now = (): string => new Date().toISOString();
const newId = (): string => crypto.randomUUID();

// ── Users ────────────────────────────────────────────────────────────────────────
/** Create a user resource. */
export function createUser(input: Partial<ScimUser> & { userName: string }): ScimUser {
  ensureLoaded();
  const id = newId();
  const user: ScimUser = {
    id,
    userName: input.userName,
    externalId: input.externalId,
    active: input.active ?? true,
    displayName: input.displayName,
    emails: input.emails,
    groups: input.groups ?? [],
    meta: { resourceType: "User", created: now(), lastModified: now() },
  };
  dir.users[id] = user;
  persist();
  return user;
}

/** The user with this id, or null. */
export function getUser(id: string): ScimUser | null { ensureLoaded(); return dir.users[id] ?? null; }

/** Replace a user (PUT). */
export function replaceUser(id: string, input: Partial<ScimUser>): ScimUser | null {
  ensureLoaded();
  const existing = dir.users[id];
  if (!existing) return null;
  const updated: ScimUser = {
    ...existing,
    userName: input.userName ?? existing.userName,
    externalId: input.externalId ?? existing.externalId,
    active: input.active ?? existing.active,
    displayName: input.displayName ?? existing.displayName,
    emails: input.emails ?? existing.emails,
    groups: input.groups ?? existing.groups,
    meta: { ...existing.meta, lastModified: now() },
  };
  dir.users[id] = updated;
  persist();
  return updated;
}

/** One SCIM PATCH operation, normalized: lower-cased `op`/`path`, defaulted when absent. */
interface NormalizedScimOp { op: string; path: string; value: unknown }

/** Normalize a batch of SCIM PATCH operations — the shape `patchUser` and `patchGroup` both
 *  loop over before branching on their own fields. */
function* normalizedOps(operations: Array<{ op: string; path?: string; value?: unknown }>): Generator<NormalizedScimOp> {
  for (const opRaw of operations) {
    yield { op: (opRaw.op || "").toLowerCase(), path: (opRaw.path || "").toLowerCase(), value: opRaw.value };
  }
}

/** Apply a SCIM PATCH (the subset IdPs use — most importantly toggling `active`). */
export function patchUser(id: string, operations: Array<{ op: string; path?: string; value?: unknown }>): ScimUser | null {
  ensureLoaded();
  const user = dir.users[id];
  if (!user) return null;
  for (const { op, path: p, value } of normalizedOps(operations)) {
    if (op === "replace" || op === "add") {
      if (p === "active" || (!p && typeof value === "object" && value && "active" in (value as object))) {
        const v = p === "active" ? value : (value as { active?: unknown }).active;
        user.active = v === true || v === "true";
      } else if (p === "displayname") {
        user.displayName = String(value ?? "");
      } else if (p === "username") {
        user.userName = String(value ?? user.userName);
      }
    }
  }
  user.meta.lastModified = now();
  persist();
  return user;
}

/** Delete (hard) a user. */
export function deleteUser(id: string): boolean {
  ensureLoaded();
  if (!(id in dir.users)) return false;
  delete dir.users[id];
  persist();
  return true;
}

/** List users, optionally filtered by a simple `attr eq "value"` SCIM filter. */
export function listUsers(filter?: string): ScimUser[] {
  ensureLoaded();
  const all = Object.values(dir.users);
  const parsed = parseEqFilter(filter);
  if (!parsed) return all;
  const { attr, value } = parsed;
  return all.filter((u) => {
    if (attr === "username") return u.userName.toLowerCase() === value.toLowerCase();
    if (attr === "externalid") return (u.externalId ?? "").toLowerCase() === value.toLowerCase();
    if (attr === "emails.value" || attr === "emails") return (u.emails ?? []).some((e) => e.value.toLowerCase() === value.toLowerCase());
    return false;
  });
}

// ── Groups ─────────────────────────────────────────────────────────────────────
/** Create a group resource. */
export function createGroup(input: Partial<ScimGroup> & { displayName: string }): ScimGroup {
  ensureLoaded();
  const id = newId();
  const group: ScimGroup = {
    id,
    displayName: input.displayName,
    externalId: input.externalId,
    members: input.members ?? [],
    meta: { resourceType: "Group", created: now(), lastModified: now() },
  };
  dir.groups[id] = group;
  syncGroupMembership();
  persist();
  return group;
}

/** The group with this id, or null. */
export function getGroup(id: string): ScimGroup | null { ensureLoaded(); return dir.groups[id] ?? null; }

/** Replace/patch a group's membership + name, then re-sync each user's group display names. */
export function replaceGroup(id: string, input: Partial<ScimGroup>): ScimGroup | null {
  ensureLoaded();
  const existing = dir.groups[id];
  if (!existing) return null;
  existing.displayName = input.displayName ?? existing.displayName;
  if (input.members) existing.members = input.members;
  existing.meta.lastModified = now();
  syncGroupMembership();
  persist();
  return existing;
}

/** Apply a group PATCH (add/remove members — what IdPs send for group assignment). */
export function patchGroup(id: string, operations: Array<{ op: string; path?: string; value?: unknown }>): ScimGroup | null {
  ensureLoaded();
  const group = dir.groups[id];
  if (!group) return null;
  for (const { op, path: p, value } of normalizedOps(operations)) {
    if (p === "members" || p.startsWith("members")) {
      const members = Array.isArray(value) ? (value as Array<{ value: string }>) : [];
      if (op === "add") for (const m of members) { if (!group.members.some((x) => x.value === m.value)) group.members.push({ value: m.value }); }
      else if (op === "remove") {
        // Two remove encodings: Entra sends a `value` array; Okta encodes the single member in the
        // path filter `members[value eq "<id>"]`. Handle both — otherwise Okta's deprovision-from-group
        // is a silent no-op and the user keeps the group-derived role. (User ids are lowercase uuids,
        // so matching against the lowercased path is safe.)
        const removeIds = new Set<string>(members.map((m) => m.value));
        const filtered = p.match(/members\[value eq "(.+?)"\]/);
        if (filtered?.[1]) removeIds.add(filtered[1]);
        group.members = group.members.filter((x) => !removeIds.has(x.value));
      }
      else if (op === "replace") group.members = members.map((m) => ({ value: m.value }));
    } else if (p === "displayname" && (op === "replace" || op === "add")) {
      group.displayName = String(value ?? group.displayName);
    }
  }
  group.meta.lastModified = now();
  syncGroupMembership();
  persist();
  return group;
}

/** Delete a group. */
export function deleteGroup(id: string): boolean {
  ensureLoaded();
  if (!(id in dir.groups)) return false;
  delete dir.groups[id];
  syncGroupMembership();
  persist();
  return true;
}

/** List groups (optional `displayName eq "..."` filter). */
export function listGroups(filter?: string): ScimGroup[] {
  ensureLoaded();
  const all = Object.values(dir.groups);
  const parsed = parseEqFilter(filter);
  if (!parsed) return all;
  return all.filter((g) => parsed.attr === "displayname" && g.displayName.toLowerCase() === parsed.value.toLowerCase());
}

/** Recompute each user's `groups` display-name list from current group membership. */
function syncGroupMembership(): void {
  // Null-prototype map: a member `value` of "__proto__"/"constructor"/"toString" etc. would
  // otherwise read an inherited Object.prototype member, so `??=` never assigns and `.push`
  // throws — a SCIM client could crash every group write. Object.create(null) has no such keys.
  const byUser: Record<string, string[]> = Object.create(null);
  for (const g of Object.values(dir.groups)) {
    for (const m of g.members) (byUser[m.value] ??= []).push(g.displayName);
  }
  for (const u of Object.values(dir.users)) u.groups = byUser[u.id] ?? [];
}

// ── Login overlay (consumed by rbac + the auth gate) ────────────────────────────
/**
 * What the directory says about a principal at request time. `known=false` ⇒ SCIM has no
 * opinion (fall back to pure OIDC). `active=false` ⇒ deprovisioned (deny). `roleClaims` are
 * the user's group display names, merged into the OIDC role claims for grant resolution.
 */
export function directoryDecision(identity: { email?: string | undefined; sub?: string | undefined; userName?: string | undefined }): { known: boolean; active: boolean; roleClaims: string[] } {
  if (!scimEnabled()) return { known: false, active: true, roleClaims: [] };
  ensureLoaded();
  const email = identity.email?.toLowerCase();
  const sub = identity.sub?.toLowerCase();
  const userName = identity.userName?.toLowerCase();
  const user = Object.values(dir.users).find((u) => {
    const un = u.userName.toLowerCase();
    if (userName && un === userName) return true;
    if (email && (un === email || (u.emails ?? []).some((e) => e.value.toLowerCase() === email))) return true;
    if (sub && (u.externalId ?? "").toLowerCase() === sub) return true;
    return false;
  });
  if (!user) return { known: false, active: true, roleClaims: [] };
  return { known: true, active: user.active, roleClaims: user.groups ?? [] };
}

/** Parse a simple SCIM `attribute eq "value"` filter (the form IdPs use for lookups). */
function parseEqFilter(filter?: string): { attr: string; value: string } | null {
  if (!filter) return null;
  const m = /^\s*([\w.]+)\s+eq\s+"([^"]*)"\s*$/i.exec(filter);
  return m ? { attr: m[1]!.toLowerCase(), value: m[2]! } : null;
}

/** Directory counts for diagnostics. */
export function scimStats(): { enabled: boolean; users: number; groups: number } {
  ensureLoaded();
  return { enabled: scimEnabled(), users: Object.keys(dir.users).length, groups: Object.keys(dir.groups).length };
}

/** Test-only: wipe the directory. */
export function __resetScim(): void { dir = { users: {}, groups: {} }; store.reset(); }
