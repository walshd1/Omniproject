/**
 * Concurrent-session cap. Sessions are stateless sealed cookies, so we keep a small,
 * best-effort in-memory registry of each user's currently-active session ids (the per-session
 * `salt`). When a user exceeds MAX_SESSIONS_PER_USER, the OLDEST sessions (by first-seen) fall
 * outside the cap and are denied — newest logins win — until they age out of the registry.
 *
 * HONEST SCOPE: the registry is per-replica RAM. Behind N replicas a user could hold up to
 * cap×N sessions; a shared store (Redis) would make it global. Unset / 0 ⇒ unlimited (no-op).
 *
 * DELIBERATELY NOT shared via the sharedKv seam (unlike audit-chain / config-store / the
 * governance log). `registerSession` is a SYNC auth hot-path called on every authenticated
 * request; the shared-state seam is async, so adopting it would force this decision to await a
 * Redis round-trip inline in auth. That async refactor of the auth path is higher-risk and out
 * of scope here, so the per-replica cap is a knowingly-accepted limit rather than an oversight.
 */
import { createHash } from "node:crypto";
import { sharedKv } from "./shared-state";

interface Entry { first: number; last: number }
const users = new Map<string, Map<string, Entry>>();

/** The configured per-user concurrent-session cap (0 / unset ⇒ unlimited). */
export function maxSessionsPerUser(): number {
  const n = Number(process.env["MAX_SESSIONS_PER_USER"]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function absoluteWindowMs(): number {
  // Registry pruning window — tracks the session absolute cap (default kept in sync with
  // lib/session-timeout DEFAULT_ABSOLUTE_HOURS). A finite window regardless, so the registry can't
  // grow unbounded even if the absolute cap is env-disabled.
  const h = Number(process.env["SESSION_ABSOLUTE_HOURS"]);
  return (Number.isFinite(h) && h > 0 ? h : 4) * 3_600_000;
}

/**
 * Record activity for (sub, sid) and report whether this session is within the cap. A session
 * outside the cap (an older one, once the user logs in beyond the limit) returns false so the
 * caller treats it as signed-out. No-op (always true) when the cap is unset.
 */
export function registerSession(sub: string, sid: string, now: number): boolean {
  const cap = maxSessionsPerUser();
  if (cap <= 0) return true;

  let map = users.get(sub);
  if (!map) { map = new Map(); users.set(sub, map); }

  // Drop sessions past the absolute window (they're dead anyway), so the registry stays small
  // and an aged-out id can't keep occupying a slot.
  const cutoff = now - absoluteWindowMs();
  for (const [id, e] of map) if (e.last < cutoff) map.delete(id);

  const existing = map.get(sid);
  if (existing) existing.last = now;
  else map.set(sid, { first: now, last: now });

  if (map.size === 0) { users.delete(sub); return true; }

  // The allowed set is the `cap` most recently STARTED sessions (newest logins win).
  const allowed = new Set(
    [...map.entries()].sort((a, b) => b[1].first - a[1].first).slice(0, cap).map(([id]) => id),
  );
  return allowed.has(sid);
}

/** How many sessions the registry currently tracks for a user (diagnostics). */
export function activeSessionCount(sub: string): number {
  return users.get(sub)?.size ?? 0;
}

// ── Per-session SEQUENCE (rotating-token replay / reuse detection) ────────────────────────────────
//
// The session cookie carries a monotonic `seq` (inside the AES-GCM-authenticated payload, so it can't
// be forged or reordered without SESSION_SECRET). Each re-seal ISSUES the next seq; every read checks
// the presented seq against the high-water mark for that session id (`salt`). A cookie presented
// CLEARLY behind the high-water mark is a replay of a superseded copy — i.e. the session forked (two
// holders). Reuse-detection best practice (as with OAuth refresh-token rotation): kill the whole
// session so BOTH holders must re-authenticate; the attacker, lacking credentials, can't — while the
// legitimate user simply signs in again. A small GRACE window absorbs normal browser request
// concurrency (many in-flight requests share the pre-re-seal cookie) so it never false-kills.
//
// SCOPE: the high-water mark is per-replica RAM for the SYNC auth-hot-path read. In MULTI-REPLICA mode
// (a fleet declared via REDIS_URL) the mark is ALSO published to — and reconciled from — shared state
// (below), so a replay of a superseded cookie that lands FIRST on a replica which never served the
// session is still caught on its next request. That cross-replica publish is NON-OPTIONAL in a declared
// fleet: sequence enforcement can't be switched off there (see `sequenceEnforced`), and the publish is
// gated on the fleet declaration rather than on Redis having finished connecting, so it is never silently
// dropped during warm-up. A single-replica deployment keeps the pure per-replica mark (exact by design).
interface SeqEntry { high: number; last: number; killed: boolean }
const seqs = new Map<string, SeqEntry>();

/** Grace: accept a presented seq within this many steps of the high-water mark without treating it as
 *  a fork — covers the in-flight window where just-superseded cookies are still arriving under browser
 *  request concurrency. Beyond it, a lower seq is a genuine replay. Tunable for very high concurrency. */
function seqGrace(): number {
  const n = Number(process.env["SESSION_SEQUENCE_GRACE"]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 5;
}

/** Whether a fleet is DECLARED (multi-replica) — the same signal fleet-readiness uses: REDIS_URL set.
 *  A replica that declared it but hasn't actually achieved Redis-backed shared state is held out of the
 *  load balancer by /readyz (lib/fleet-readiness), so "declared" is the operative multi-replica marker. */
function fleetDeclared(): boolean {
  return !!process.env["REDIS_URL"]?.trim();
}

/** Whether rotating-token sequence enforcement is on. Default ON; `SESSION_SEQUENCE_ENFORCE=0` disables
 *  it — but ONLY in a single-replica deployment. In MULTI-REPLICA mode (a fleet declared via REDIS_URL)
 *  enforcement is NON-OPTIONAL: the shared cross-replica seq-mark makes fork detection reliable across
 *  replicas, so the one documented reason to disable it (per-replica missed detections on a non-sticky
 *  fleet) no longer applies — the off-switch is ignored there rather than silently dropping fleet-wide
 *  session-fork detection. */
export function sequenceEnforced(): boolean {
  if (fleetDeclared()) return true;
  const v = process.env["SESSION_SEQUENCE_ENFORCE"]?.trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off" && v !== "no";
}

function pruneSeqs(now: number): void {
  const cutoff = now - absoluteWindowMs();
  for (const [id, e] of seqs) if (e.last < cutoff) seqs.delete(id);
}

// ── Cross-replica mark (fleet detection of a replay that lands on a fresh replica) ──────────────────
// The high-water mark is per-replica for the SYNC read, but in a DECLARED FLEET (REDIS_URL set) we also
// publish it to — and reconcile it from — shared state, so a replay of a superseded cookie that lands
// FIRST on a replica which never served the session is still caught. This is gated on the fleet being
// DECLARED, not on `sharedStateMode()` being "redis" at the instant of the call: `sharedKv` awaits its
// own readiness and routes to Redis once connected, so the mark is published even during the brief
// warm-up window rather than being silently skipped. In single-replica (no fleet declared) the issuing
// replica already holds the mark locally, so there is no cross-replica "first sight" to reconcile and
// the publish is skipped. Sequence enforcement is always on in a declared fleet, so this publish is
// non-optional there — it can't be turned off, and it can't be missed while Redis is still connecting.
const SEQ_MARK_PREFIX = "seq:mark:";

function publishSeqMark(salt: string, high: number): void {
  if (!sequenceEnforced() || !fleetDeclared()) return;
  void sharedKv.set(SEQ_MARK_PREFIX + salt, String(high), { ttlMs: absoluteWindowMs() }).catch(() => { /* best-effort */ });
}

/** Fire-and-forget on FIRST sight of a salt on this replica: if the fleet's known mark is well ahead of
 *  the presented seq, this is a replay of a superseded copy that landed here first ⇒ mark the session
 *  killed so its NEXT request forks (and readSession revokes it fleet-wide). Never blocks the read. */
function reconcileFirstSight(salt: string, seq: number): void {
  if (!fleetDeclared()) return;
  void (async () => {
    try {
      const raw = await sharedKv.get(SEQ_MARK_PREFIX + salt);
      const remote = raw === null ? NaN : Number(raw);
      if (Number.isFinite(remote) && remote > seq + seqGrace()) {
        const e = seqs.get(salt);
        if (e) e.killed = true; // next request → fork → fleet-wide revoke (assume-breach)
      }
    } catch { /* best-effort */ }
  })();
}

/** Issue the next sequence number for a session (called when its cookie is (re)sealed). Advancing the
 *  high-water mark is what makes an older, captured copy of the cookie detectably out-of-sequence. */
export function issueSequence(salt: string, now: number): number {
  pruneSeqs(now);
  const e = seqs.get(salt);
  const high = !e || e.killed ? (e?.high ?? 0) + 1 : (e.high += 1);
  if (!e || e.killed) seqs.set(salt, { high, last: now, killed: false });
  else e.last = now;
  publishSeqMark(salt, high); // fan the mark out so other replicas can detect a stale replay
  return high;
}

export type SeqVerdict = "ok" | "fork";

/**
 * Check a presented sequence against the session's high-water mark. `ok` = in order (accept; advances
 * the mark). `fork` = a replay of a superseded cookie was seen → the session is KILLED (this and every
 * future request for this salt is rejected until re-auth). First sight of a salt is always `ok`
 * (grandfathers cookies minted before sequencing, and seeds the mark). No-op `ok` when disabled.
 */
export function checkSequence(salt: string, seq: number, now: number): SeqVerdict {
  if (!sequenceEnforced()) return "ok";
  const e = seqs.get(salt);
  if (!e) {
    // First sight on THIS replica: seed the mark, accept — but reconcile against the fleet's known mark
    // (best-effort, async) so a replay that landed here first is caught on its next request.
    seqs.set(salt, { high: seq, last: now, killed: false });
    reconcileFirstSight(salt, seq);
    return "ok";
  }
  if (e.killed) return "fork"; // family already burned by a detected reuse
  e.last = now;
  if (seq >= e.high) { e.high = seq; return "ok"; }
  if (seq >= e.high - seqGrace()) return "ok"; // within the concurrency grace window
  e.killed = true; // a cookie well behind the mark ⇒ fork/replay ⇒ burn the session for everyone
  return "fork";
}

// ── Device & active-session inventory (IAM S8) ──────────────────────────────────────────────────────
//
// The concurrent-session cap above is a NO-OP when MAX_SESSIONS_PER_USER is unset (the default), so it
// can't back a "your active devices" view. This directory is ALWAYS on: it records every live session so
// the owner can list their devices and sign one out. Same honest scope as the rest of this module —
// best-effort per-replica RAM, pruned by the absolute window — with one addition: a per-session REVOKE is
// published to, and reconciled from, shared state in a DECLARED FLEET (REDIS_URL set), mirroring the
// seq-mark cross-replica pattern, so signing a device out propagates fleet-wide rather than staying on the
// replica that served the request. The raw per-session salt is the id key here but NEVER leaves the server;
// callers identify a session by `sessionPublicId` (a non-reversible SHA-256 handle).
interface DirEntry { first: number; last: number; ua?: string; ip?: string; revoked?: boolean }
const directory = new Map<string, Map<string, DirEntry>>();

/** A session as surfaced to its owner. `id` is the non-reversible public handle, not the raw salt. */
export interface SessionInfo { id: string; first: number; last: number; ua?: string; ip?: string }

const REVOKE_PREFIX = "sess:revoked:";

function pruneDirectory(map: Map<string, DirEntry>, now: number): void {
  // Past the absolute window the underlying cookie is expired anyway (readSession's isSessionExpired),
  // so dropping the entry — revoked or not — loses nothing and keeps the directory bounded.
  const cutoff = now - absoluteWindowMs();
  for (const [id, e] of map) if (e.last < cutoff) map.delete(id);
}

/** A short, non-reversible public handle for a session id, so the raw per-session salt (which seeds the
 *  per-session broker key) never leaves the server. Stable for a given salt; used as the inventory id. */
export function sessionPublicId(sid: string): string {
  return createHash("sha256").update(sid).digest("hex").slice(0, 16);
}

/** Record/refresh a live session in the directory (always on, independent of the concurrent-session cap).
 *  Called on the authenticated read path with the request's device metadata. */
export function noteSession(sub: string, sid: string, now: number, meta?: { ua?: string; ip?: string }): void {
  let map = directory.get(sub);
  if (!map) { map = new Map(); directory.set(sub, map); }
  pruneDirectory(map, now);
  const e = map.get(sid);
  if (e) {
    e.last = now;
    if (meta?.ua) e.ua = meta.ua;
    if (meta?.ip) e.ip = meta.ip;
  } else {
    map.set(sid, { first: now, last: now, ...(meta?.ua ? { ua: meta.ua } : {}), ...(meta?.ip ? { ip: meta.ip } : {}) });
  }
}

/** The caller's live (non-revoked) sessions, newest-activity first. */
export function listUserSessions(sub: string, now: number): SessionInfo[] {
  const map = directory.get(sub);
  if (!map) return [];
  pruneDirectory(map, now);
  return [...map.entries()]
    .filter(([, e]) => !e.revoked)
    .sort((a, b) => b[1].last - a[1].last)
    .map(([sid, e]) => ({ id: sessionPublicId(sid), first: e.first, last: e.last, ...(e.ua ? { ua: e.ua } : {}), ...(e.ip ? { ip: e.ip } : {}) }));
}

function publishRevoke(sid: string): void {
  if (!fleetDeclared()) return;
  void sharedKv.set(REVOKE_PREFIX + sid, "1", { ttlMs: absoluteWindowMs() }).catch(() => { /* best-effort */ });
}

/** Revoke ONE of a user's sessions by its public handle. Returns true if a match was found. The session
 *  reads as signed-out on its next request — here, and (in a declared fleet) on every replica. */
export function revokeSession(sub: string, publicId: string): boolean {
  const map = directory.get(sub);
  if (!map) return false;
  for (const [sid, e] of map) {
    if (sessionPublicId(sid) === publicId) {
      e.revoked = true;
      publishRevoke(sid);
      return true;
    }
  }
  return false;
}

/** Revoke every session EXCEPT the one identified by keepPublicId ("sign out all other devices").
 *  Returns how many were revoked. */
export function revokeOtherSessions(sub: string, keepPublicId: string): number {
  const map = directory.get(sub);
  if (!map) return 0;
  let n = 0;
  for (const [sid, e] of map) {
    if (e.revoked || sessionPublicId(sid) === keepPublicId) continue;
    e.revoked = true;
    publishRevoke(sid);
    n++;
  }
  return n;
}

/** Fire-and-forget on FIRST sight of an unknown (sub,sid) on this replica: if the fleet holds a revoke
 *  marker for it, seed a revoked entry so its NEXT request reads as signed-out (mirrors reconcileFirstSight). */
function reconcileRevoke(sub: string, sid: string, now: number): void {
  if (!fleetDeclared()) return;
  void (async () => {
    try {
      const raw = await sharedKv.get(REVOKE_PREFIX + sid);
      if (raw == null) return;
      let map = directory.get(sub);
      if (!map) { map = new Map(); directory.set(sub, map); }
      const cur = map.get(sid);
      if (cur) cur.revoked = true;
      else map.set(sid, { first: now, last: now, revoked: true });
    } catch { /* best-effort */ }
  })();
}

/** Whether a session (by sub+salt) has been revoked. Sync per-replica check on the auth hot-path; on first
 *  sight of an unknown session in a fleet, kicks an async reconcile so a revoke that landed elsewhere is
 *  caught on the next request. Checked in readSession — a revoked session reads as signed-out. */
export function isSessionRevoked(sub: string, sid: string, now: number): boolean {
  const e = directory.get(sub)?.get(sid);
  if (e?.revoked) return true;
  if (!e) reconcileRevoke(sub, sid, now);
  return false;
}

/** Test-only: clear the registry. */
export function __resetSessionRegistry(): void { users.clear(); seqs.clear(); directory.clear(); }
