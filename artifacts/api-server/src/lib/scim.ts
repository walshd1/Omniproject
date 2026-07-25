import crypto from "node:crypto";
import { logger } from "./logger";
import { SealedFile, resolveConfigFile } from "./sealed-file";
import { constantTimeEqual } from "./crypto-keys";
import { sharedKv } from "./shared-state";
import { isForbiddenKey, safeParseJson } from "./safe-json";

/**
 * SECURITY: the directory maps are plain objects indexed by the SCIM resource `id`, which arrives
 * as a raw URL path segment (`/scim/v2/Users/:id`). The global body reviver strips `__proto__` /
 * `constructor` / `prototype` from request BODIES but not from route PARAMS — so an id of `__proto__`
 * would otherwise read `Object.prototype` (a truthy phantom resource) and, on PUT, `dir.users["__proto__"] = …`
 * would invoke the prototype setter and pollute/corrupt the map (then get persisted). Every by-id entry
 * point rejects a forbidden key up front, so those names resolve to "not found" instead of the prototype.
 */
const safeId = (id: string): boolean => !isForbiddenKey(id);

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
// Tombstones: id → deletedAt (epoch ms). A hard-deleted user/group leaves no record, so LWW alone
// would let a sibling's stale copy resurrect it; a tombstone that out-dates the record suppresses it.
let tombstones: Record<string, number> = {};
const store = new SealedFile(() => resolveConfigFile("SCIM_STATE_FILE", "scim.json"), "scim");

/**
 * FLEET BEHAVIOUR. The directory is loaded once per replica and mutated in place, so behind
 * horizontal scale an IdP deactivation (`active=false`) landing on replica A would leave B…N letting
 * the user pass the gate until each reloaded. This routes the directory through the shared-state seam:
 * every mutation write-throughs the directory, and each replica pulls it in on a fleet-sync tick, so a
 * deprovision on ANY replica takes effect fleet-wide within the interval when shared state is
 * Redis-backed (per-replica otherwise). A directory is NOT monotonic — a later reactivation must win —
 * so the merge is **per-record last-writer-wins keyed on `meta.lastModified`**, with tombstones for
 * hard deletes. The gate read (`directoryDecision`) stays synchronous against the converged local copy.
 */
export const SCIM_SHARED_KEY = "security:scim-directory";
interface ScimShared { users: Record<string, ScimUser>; groups: Record<string, ScimGroup>; tombstones: Record<string, number> }
const epoch = (iso: string | undefined): number => (iso ? Date.parse(iso) || 0 : 0);

/** Per-record LWW merge of two directory snapshots: newer `meta.lastModified` wins; a tombstone that
 *  out-dates a record drops it. Deterministic (ids sorted) so the caller can skip an unchanged re-write. */
function mergeDirectories(a: ScimShared, b: ScimShared): ScimShared {
  const tomb: Record<string, number> = {};
  for (const id of new Set([...Object.keys(a.tombstones ?? {}), ...Object.keys(b.tombstones ?? {})])) {
    tomb[id] = Math.max(a.tombstones?.[id] ?? 0, b.tombstones?.[id] ?? 0);
  }
  const pick = <T extends { meta: { lastModified: string } }>(x: T | undefined, y: T | undefined): T =>
    (epoch(y?.meta.lastModified) > epoch(x?.meta.lastModified) ? y! : (x ?? y!));
  const users: Record<string, ScimUser> = {};
  for (const id of [...new Set([...Object.keys(a.users ?? {}), ...Object.keys(b.users ?? {})])].sort()) {
    const rec = pick(a.users?.[id], b.users?.[id]);
    if ((tomb[id] ?? 0) >= epoch(rec.meta.lastModified)) continue; // deleted after its last update
    users[id] = rec;
  }
  const groups: Record<string, ScimGroup> = {};
  for (const id of [...new Set([...Object.keys(a.groups ?? {}), ...Object.keys(b.groups ?? {})])].sort()) {
    const rec = pick(a.groups?.[id], b.groups?.[id]);
    if ((tomb[id] ?? 0) >= epoch(rec.meta.lastModified)) continue;
    groups[id] = rec;
  }
  return { users, groups, tombstones: tomb };
}

/** Validate an untrusted shared-directory blob from the fleet KV BEFORE it can influence authorization.
 *  Any replica (or anyone able to write `security:scim-directory`) can put this value, so a hostile or
 *  buggy one must not be able to grant roles, reactivate a deprovisioned user, or pollute the prototype.
 *  Parse prototype-safe, then keep only well-formed records under safe ids; drop everything else. */
export function sanitizeSharedDirectory(raw: string): ScimShared {
  const parsed = safeParseJson<Partial<ScimShared>>(raw) ?? {};
  const out: ScimShared = { users: {}, groups: {}, tombstones: {} };
  const validMeta = (m: unknown): boolean =>
    !!m && typeof m === "object" && typeof (m as { lastModified?: unknown }).lastModified === "string";
  for (const [id, rec] of Object.entries(parsed.users ?? {})) {
    if (safeId(id) && rec && typeof rec === "object" && validMeta((rec as ScimUser).meta)) out.users[id] = rec as ScimUser;
  }
  for (const [id, rec] of Object.entries(parsed.groups ?? {})) {
    if (safeId(id) && rec && typeof rec === "object" && validMeta((rec as ScimGroup).meta)) out.groups[id] = rec as ScimGroup;
  }
  for (const [id, ts] of Object.entries(parsed.tombstones ?? {})) {
    if (safeId(id) && typeof ts === "number" && Number.isFinite(ts)) out.tombstones[id] = ts;
  }
  return out;
}

/**
 * Converge this replica's directory with shared state once (the fleet-sync tick, also directly
 * testable). LWW-merges the shared snapshot into local, recomputes group-derived roles, and — anti
 * entropy — writes the union back when it differs, so a change held only here (e.g. restored from this
 * replica's sealed file at boot) can't be lost to a sibling. Keeps local on a shared-state blip.
 */
export async function refreshScimFromShared(): Promise<void> {
  try {
    const raw = await sharedKv.get(SCIM_SHARED_KEY);
    // Untrusted fleet input — validate before it can grant/reactivate anything (see sanitizeSharedDirectory).
    const shared: ScimShared = raw ? sanitizeSharedDirectory(raw) : { users: {}, groups: {}, tombstones: {} };
    const merged = mergeDirectories({ users: dir.users, groups: dir.groups, tombstones }, shared);
    dir.users = merged.users;
    dir.groups = merged.groups;
    tombstones = merged.tombstones;
    syncGroupMembership(); // user.groups follows the merged group membership, not whichever side's stale copy won
    const out = JSON.stringify(merged);
    if (out !== raw) await sharedKv.set(SCIM_SHARED_KEY, out);
  } catch {
    /* keep last-known local directory on a shared-state blip */
  }
}

/** Fan the current directory out to the fleet after a local mutation (best-effort; local already set). */
function publishScim(): void { void refreshScimFromShared(); }

let fleetTimer: ReturnType<typeof setInterval> | null = null;
/** Start periodic fleet convergence so a deprovision on ANY replica takes effect here. Idempotent;
 *  unref'd so it never keeps the process alive. Returns a stop handle. */
export function startScimFleetSync(intervalMs = 3000): () => void {
  if (!fleetTimer) {
    fleetTimer = setInterval(() => { void refreshScimFromShared(); }, intervalMs);
    fleetTimer.unref?.();
  }
  return stopScimFleetSync;
}
/** Stop the periodic SCIM directory fleet-sync poll (idempotent) — used on shutdown / in tests. */
export function stopScimFleetSync(): void {
  if (fleetTimer) { clearInterval(fleetTimer); fleetTimer = null; }
}

/** Minimum SCIM token length. SCIM controls deprovisioning + group→role-claim membership, so a weak,
 *  brute-forceable token is a direct privilege-escalation / mass-deprovision target — mirror the same
 *  floor break-glass enforces (lib/break-glass MIN_TOKEN_LEN). A shorter token DISABLES SCIM (fail-closed)
 *  rather than authorising it, and the boot self-check surfaces the misconfig (lib/security-check). */
export const MIN_SCIM_TOKEN_LEN = 24;

/** The configured SCIM bearer token, or null when unset or too weak (⇒ SCIM disabled). */
export function scimToken(): string | null {
  const t = process.env["SCIM_TOKEN"]?.trim();
  return t && t.length >= MIN_SCIM_TOKEN_LEN ? t : null;
}

/** Is SCIM provisioning enabled? (Only when a STRONG bearer token is configured.) */
export function scimEnabled(): boolean {
  return scimToken() !== null;
}

/** Constant-time check of a presented SCIM bearer token (rejects when the configured token is too weak). */
export function scimTokenValid(presented: string | undefined): boolean {
  const expected = scimToken();
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
  publishScim(); // fan the change out to the fleet (best-effort; local + sealed file already written)
}

const now = (): string => new Date().toISOString();
const newId = (): string => crypto.randomUUID();

// ── Users ────────────────────────────────────────────────────────────────────────

/** Coerce an untrusted SCIM `active` value to a STRICT boolean (matching patchUser). IdPs sometimes
 *  send the string "true"/"false"; `undefined` falls back. Zero-trust: without this, a non-boolean
 *  `active` (e.g. "false") is stored verbatim and the deprovisioning gate (`!active`) reads a disabled
 *  leaver as still-active — a silent deprovisioning bypass. */
function coerceActive(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  return value === true || value === "true";
}

/** Keep only well-formed `{ value: string }` email entries — an IdP-supplied `emails:[{value:123}]`
 *  would otherwise be stored and later throw at `e.value.toLowerCase()` in the lookup/decision path. */
function cleanEmails(input: unknown): ScimEmail[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out = input
    .filter((e): e is ScimEmail => !!e && typeof e === "object" && typeof (e as { value?: unknown }).value === "string")
    .map((e) => ({ value: e.value, ...(typeof e.primary === "boolean" ? { primary: e.primary } : {}), ...(typeof e.type === "string" ? { type: e.type } : {}) }));
  return out.length ? out : undefined;
}

/** Keep only string group display-names (they flow into the role-claim merge, so a non-string is
 *  dropped rather than trusted). */
function cleanGroups(input: unknown): string[] {
  return Array.isArray(input) ? input.filter((g): g is string => typeof g === "string" && g.trim() !== "") : [];
}

/** Create a user resource. */
export function createUser(input: Partial<ScimUser> & { userName: string }): ScimUser {
  ensureLoaded();
  const id = newId();
  const user: ScimUser = {
    id,
    userName: input.userName,
    externalId: input.externalId,
    active: coerceActive(input.active, true),
    displayName: input.displayName,
    emails: cleanEmails(input.emails),
    groups: cleanGroups(input.groups),
    meta: { resourceType: "User", created: now(), lastModified: now() },
  };
  dir.users[id] = user;
  persist();
  return user;
}

/** The user with this id, or null. */
export function getUser(id: string): ScimUser | null { if (!safeId(id)) return null; ensureLoaded(); return dir.users[id] ?? null; }

/** Replace a user (PUT). */
export function replaceUser(id: string, input: Partial<ScimUser>): ScimUser | null {
  if (!safeId(id)) return null;
  ensureLoaded();
  const existing = dir.users[id];
  if (!existing) return null;
  const updated: ScimUser = {
    ...existing,
    userName: input.userName ?? existing.userName,
    externalId: input.externalId ?? existing.externalId,
    active: coerceActive(input.active, existing.active),
    displayName: input.displayName ?? existing.displayName,
    emails: input.emails !== undefined ? cleanEmails(input.emails) : existing.emails,
    groups: input.groups !== undefined ? cleanGroups(input.groups) : existing.groups,
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
  if (!safeId(id)) return null;
  ensureLoaded();
  const user = dir.users[id];
  if (!user) return null;
  for (const { op, path: p, value } of normalizedOps(operations)) {
    if (op === "replace" || op === "add") {
      if (p === "active" || (!p && typeof value === "object" && value && "active" in (value as object))) {
        const v = p === "active" ? value : (value as { active?: unknown }).active;
        user.active = coerceActive(v, user.active);
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
  if (!safeId(id)) return false;
  ensureLoaded();
  if (!(id in dir.users)) return false;
  delete dir.users[id];
  tombstones[id] = Date.now(); // tombstone so the delete propagates and a sibling can't resurrect it
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
export function getGroup(id: string): ScimGroup | null { if (!safeId(id)) return null; ensureLoaded(); return dir.groups[id] ?? null; }

/** Replace/patch a group's membership + name, then re-sync each user's group display names. */
export function replaceGroup(id: string, input: Partial<ScimGroup>): ScimGroup | null {
  if (!safeId(id)) return null;
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
  if (!safeId(id)) return null;
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
  if (!safeId(id)) return false;
  ensureLoaded();
  if (!(id in dir.groups)) return false;
  delete dir.groups[id];
  tombstones[id] = Date.now(); // tombstone so the delete propagates and a sibling can't resurrect it
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
export function __resetScim(): void { dir = { users: {}, groups: {} }; tombstones = {}; store.reset(); }
