import { createHmac } from "node:crypto";

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
 * issued before that instant are rejected (uses the session `iat`). All RAM-only.
 */
export const KEY_NAMES = ["session", "provenance", "broker"] as const;
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
export function revokeKey(name: KeyName, opts: { by?: string | null; reason?: string } = {}): KeyStatus {
  const s = state(name);
  s.revoked.add(s.version);
  s.version += 1;
  s.rotatedAt = new Date().toISOString();
  s.lastActor = opts.by ?? null;
  s.lastReason = opts.reason ?? null;
  return statusOf(name);
}

/** Revoke all of one user's sessions (issued before now). */
export function revokeUserSessions(sub: string): void {
  userRevokedAt[sub] = Date.now();
}

/** The instant a user's sessions were revoked, or 0. */
export function userSessionsRevokedAt(sub: string): number {
  return userRevokedAt[sub] ?? 0;
}

/** Test-only: reset all key state. */
export function __resetKeyRegistry(): void {
  for (const k of Object.keys(keys)) delete keys[k];
  for (const k of Object.keys(userRevokedAt)) delete userRevokedAt[k];
}
