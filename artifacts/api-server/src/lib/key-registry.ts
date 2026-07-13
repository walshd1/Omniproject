import { createHmac } from "node:crypto";
import { sharedKv } from "./shared-state";

/**
 * Key registry with admin-gated revocation.
 *
 * Each named key (session / provenance / broker) has a current VERSION. The signing
 * material for a version is DERIVED from an env master — `HMAC(master, "name:vN")` — so
 * rotating to a new version yields a fresh key with no new secret to distribute, and the
 * material for any past version can still be re-derived to verify historical artifacts.
 *
 * Revoking a key retires its current version (added to a revoked set) and rolls forward:
 * new artifacts sign under the new version; anything signed by a revoked version is
 * rejected (sessions) or flagged untrusted (provenance — its integrity can still be
 * checked, but a leaked key could have forged it, so the guarantee is void).
 *
 * Per-user session revocation is separate: a `sub → revokedAt` mark; a user's sessions
 * issued before that instant are rejected (uses the session `iat`). RAM-first for the
 * synchronous hot-path reads.
 *
 * FLEET BEHAVIOUR: revocation is MONOTONIC — a version, once revoked, stays revoked; a user's
 * `revokedAt` only moves forward — so the fleet-correct merge is a UNION (`refreshKeyRegistryFromShared`
 * write-through + periodic pull, `startKeyRegistryFleetSync`). Every revoke writes the union of the
 * local + shared state back to shared, and every replica pulls it in, so a credential revoked on ANY
 * replica takes effect fleet-wide within the sync interval when shared state is Redis-backed. The
 * merge can only ADD revocations, never drop one, so a shared-state blip or a racing writer can never
 * un-revoke — it fails toward "more revoked". Without shared state (in-process mode) it is per-replica.
 * The hot-path reads (`isActive`, `currentVersion`, `userSessionsRevokedAt`) stay synchronous.
 */
export const KEY_REGISTRY_SHARED_KEY = "security:key-registry";
export const KEY_NAMES = ["session", "provenance", "broker", "audit"] as const;
export type KeyName = (typeof KEY_NAMES)[number];

interface KeyState {
  version: number;
  revoked: Set<number>;
  rotatedAt: string | null;
  lastActor: string | null;
  lastReason: string | null;
}

const keys: Record<string, KeyState> = {};
const userRevokedAt: Record<string, number> = {};

function state(name: string): KeyState {
  return (keys[name] ??= { version: 1, revoked: new Set(), rotatedAt: null, lastActor: null, lastReason: null });
}

function master(name: string): string {
  const perName: Record<string, string | undefined> = {
    session: process.env["SESSION_SECRET"]?.trim(),
    provenance: process.env["PROVENANCE_KEY"]?.trim(),
    broker: process.env["BROKER_PSK"]?.trim(),
    audit: process.env["AUDIT_KEY"]?.trim(),
  };
  return (
    perName[name] ||
    process.env["PROVENANCE_KEY"]?.trim() ||
    process.env["BROKER_PSK"]?.trim() ||
    process.env["SESSION_SECRET"]?.trim() ||
    "omni-key-registry-dev-master-not-for-production"
  );
}

/** The current (active) version of a key. */
export function currentVersion(name: string): number {
  return state(name).version;
}

/** Is this version of a key still active (not revoked)? */
export function isActive(name: string, version: number): boolean {
  return !state(name).revoked.has(version);
}

/** Derive the signing material for a key version (hex). */
export function derivedKey(name: string, version: number = currentVersion(name)): string {
  return createHmac("sha256", master(name)).update(`${name}:v${version}`).digest("hex");
}

export interface KeyStatus {
  name: string;
  version: number;
  revokedVersions: number[];
  rotatedAt: string | null;
  lastActor: string | null;
  lastReason: string | null;
}

function statusOf(name: string): KeyStatus {
  const s = state(name);
  return { name, version: s.version, revokedVersions: [...s.revoked].sort((a, b) => a - b), rotatedAt: s.rotatedAt, lastActor: s.lastActor, lastReason: s.lastReason };
}

/** Every known key's status (for the admin view). */
export function listKeys(): KeyStatus[] {
  return KEY_NAMES.map(statusOf);
}

/** Revoke a key's current version and roll forward to a fresh derived key. */
export function revokeKey(name: KeyName, opts: { by?: string | null; reason?: string | undefined } = {}): KeyStatus {
  const s = state(name);
  s.revoked.add(s.version);
  s.version += 1;
  s.rotatedAt = new Date().toISOString();
  s.lastActor = opts.by ?? null;
  s.lastReason = opts.reason ?? null;
  void refreshKeyRegistryFromShared(); // fan the revocation out to the fleet (best-effort; local already set)
  return statusOf(name);
}

/** Revoke all of one user's sessions (issued before now). */
export function revokeUserSessions(sub: string): void {
  userRevokedAt[sub] = Date.now();
  void refreshKeyRegistryFromShared(); // fan out fleet-wide (best-effort; local already set)
}

/** The instant a user's sessions were revoked, or 0. */
export function userSessionsRevokedAt(sub: string): number {
  return userRevokedAt[sub] ?? 0;
}

export interface KeyRegistrySnapshot {
  keys: Record<string, { version: number; revoked: number[]; rotatedAt: string | null; lastActor: string | null; lastReason: string | null }>;
  userRevokedAt: Record<string, number>;
}

/** Serialisable snapshot of all revocation state (for durable persistence). */
export function snapshotKeys(): KeyRegistrySnapshot {
  const out: KeyRegistrySnapshot = { keys: {}, userRevokedAt: { ...userRevokedAt } };
  for (const [name, s] of Object.entries(keys)) {
    out.keys[name] = { version: s.version, revoked: [...s.revoked], rotatedAt: s.rotatedAt, lastActor: s.lastActor, lastReason: s.lastReason };
  }
  return out;
}

/** Restore revocation state from a snapshot (boot-time durability). */
export function restoreKeys(snap: KeyRegistrySnapshot): void {
  for (const [name, s] of Object.entries(snap.keys ?? {})) {
    keys[name] = { version: s.version, revoked: new Set(s.revoked ?? []), rotatedAt: s.rotatedAt ?? null, lastActor: s.lastActor ?? null, lastReason: s.lastReason ?? null };
  }
  for (const [sub, ts] of Object.entries(snap.userRevokedAt ?? {})) userRevokedAt[sub] = ts;
}

/**
 * Union two snapshots — the deterministic, monotonic merge behind fleet convergence. A version
 * takes the MAX; a revoked set the UNION; a user's `revokedAt` the LATER instant. Metadata
 * (rotatedAt/actor/reason) follows the side with the higher version — the more recent action —
 * ties keeping `a`. Keys and subs are sorted so the output is byte-stable, which lets the caller
 * detect "shared already equals us" with a string compare and skip a redundant write.
 */
function unionSnapshots(a: KeyRegistrySnapshot, b: KeyRegistrySnapshot): KeyRegistrySnapshot {
  const out: KeyRegistrySnapshot = { keys: {}, userRevokedAt: {} };
  const names = [...new Set([...Object.keys(a.keys ?? {}), ...Object.keys(b.keys ?? {})])].sort();
  for (const name of names) {
    const ka = a.keys?.[name];
    const kb = b.keys?.[name];
    const revoked = [...new Set<number>([...(ka?.revoked ?? []), ...(kb?.revoked ?? [])])].sort((x, y) => x - y);
    const version = Math.max(ka?.version ?? 1, kb?.version ?? 1);
    const meta = kb && kb.version > (ka?.version ?? 0) ? kb : (ka ?? kb!);
    out.keys[name] = { version, revoked, rotatedAt: meta.rotatedAt ?? null, lastActor: meta.lastActor ?? null, lastReason: meta.lastReason ?? null };
  }
  const subs = [...new Set([...Object.keys(a.userRevokedAt ?? {}), ...Object.keys(b.userRevokedAt ?? {})])].sort();
  for (const sub of subs) out.userRevokedAt[sub] = Math.max(a.userRevokedAt?.[sub] ?? 0, b.userRevokedAt?.[sub] ?? 0);
  return out;
}

/**
 * Converge this replica's revocation state with shared state once (the fleet-sync tick, also
 * directly testable). Reads the shared snapshot, unions it into local (never dropping a local
 * revocation), and — anti-entropy — writes the union back when it carries more than shared, so a
 * revocation held only on this replica (e.g. restored from its sealed state file at boot, or a
 * racing writer clobbered shared) can't be lost to a freshly-booting sibling. On a shared-state
 * blip it keeps the last-known local state and fails toward "more revoked".
 */
export async function refreshKeyRegistryFromShared(): Promise<void> {
  try {
    const raw = await sharedKv.get(KEY_REGISTRY_SHARED_KEY);
    const shared: KeyRegistrySnapshot = raw ? (JSON.parse(raw) as KeyRegistrySnapshot) : { keys: {}, userRevokedAt: {} };
    const merged = unionSnapshots(snapshotKeys(), shared);
    restoreKeys(merged); // merged ⊇ local, so this only ever ADDS revocations
    if (JSON.stringify(merged) !== raw) await sharedKv.set(KEY_REGISTRY_SHARED_KEY, JSON.stringify(merged));
  } catch {
    /* keep last-known local state on a shared-state blip — revocations already applied stay applied */
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Start periodic fleet convergence so a credential revoked on ANY replica takes effect here.
 *  Idempotent; the interval is unref'd so it never keeps the process alive. Returns a stop handle. */
export function startKeyRegistryFleetSync(intervalMs = 3000): () => void {
  if (!timer) {
    timer = setInterval(() => { void refreshKeyRegistryFromShared(); }, intervalMs);
    timer.unref?.();
  }
  return stopKeyRegistryFleetSync;
}
export function stopKeyRegistryFleetSync(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

/** Test-only: reset all key state. */
export function __resetKeyRegistry(): void {
  for (const k of Object.keys(keys)) delete keys[k];
  for (const k of Object.keys(userRevokedAt)) delete userRevokedAt[k];
}
