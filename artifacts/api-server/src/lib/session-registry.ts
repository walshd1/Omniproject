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
// HONEST SCOPE: like the concurrent-session cap above, this high-water mark is per-replica RAM (the
// read is a SYNC auth hot-path). With sticky sessions it is exact; without them, a replay could land
// on a replica that hasn't yet seen the newer seq (a missed detection, never a false lockout of a real
// user). A shared store would make it fleet-global; that async refactor is out of scope here.
interface SeqEntry { high: number; last: number; killed: boolean }
const seqs = new Map<string, SeqEntry>();

/** Grace: accept a presented seq within this many steps of the high-water mark without treating it as
 *  a fork — covers the in-flight window where just-superseded cookies are still arriving under browser
 *  request concurrency. Beyond it, a lower seq is a genuine replay. Tunable for very high concurrency. */
function seqGrace(): number {
  const n = Number(process.env["SESSION_SEQUENCE_GRACE"]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 5;
}

/** Whether rotating-token sequence enforcement is on (default ON; set SESSION_SEQUENCE_ENFORCE=0 to
 *  disable, e.g. for a non-sticky fleet that would rather not risk per-replica missed detections). */
export function sequenceEnforced(): boolean {
  const v = process.env["SESSION_SEQUENCE_ENFORCE"]?.trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off" && v !== "no";
}

function pruneSeqs(now: number): void {
  const cutoff = now - absoluteWindowMs();
  for (const [id, e] of seqs) if (e.last < cutoff) seqs.delete(id);
}

/** Issue the next sequence number for a session (called when its cookie is (re)sealed). Advancing the
 *  high-water mark is what makes an older, captured copy of the cookie detectably out-of-sequence. */
export function issueSequence(salt: string, now: number): number {
  pruneSeqs(now);
  const e = seqs.get(salt);
  if (!e || e.killed) { const seq = (e?.high ?? 0) + 1; seqs.set(salt, { high: seq, last: now, killed: false }); return seq; }
  e.high += 1; e.last = now;
  return e.high;
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
  if (!e) { seqs.set(salt, { high: seq, last: now, killed: false }); return "ok"; }
  if (e.killed) return "fork"; // family already burned by a detected reuse
  e.last = now;
  if (seq >= e.high) { e.high = seq; return "ok"; }
  if (seq >= e.high - seqGrace()) return "ok"; // within the concurrency grace window
  e.killed = true; // a cookie well behind the mark ⇒ fork/replay ⇒ burn the session for everyone
  return "fork";
}

/** Test-only: clear the registry. */
export function __resetSessionRegistry(): void { users.clear(); seqs.clear(); }
