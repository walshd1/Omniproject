/**
 * Concurrent-session cap. Sessions are stateless sealed cookies, so we keep a small,
 * best-effort in-memory registry of each user's currently-active session ids (the per-session
 * `salt`). When a user exceeds MAX_SESSIONS_PER_USER, the OLDEST sessions (by first-seen) fall
 * outside the cap and are denied — newest logins win — until they age out of the registry.
 *
 * HONEST SCOPE: the registry is per-replica RAM. Behind N replicas a user could hold up to
 * cap×N sessions; a shared store (Redis) would make it global. Unset / 0 ⇒ unlimited (no-op).
 */
interface Entry { first: number; last: number }
const users = new Map<string, Map<string, Entry>>();

/** The configured per-user concurrent-session cap (0 / unset ⇒ unlimited). */
export function maxSessionsPerUser(): number {
  const n = Number(process.env["MAX_SESSIONS_PER_USER"]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function absoluteWindowMs(): number {
  const h = Number(process.env["SESSION_ABSOLUTE_HOURS"]);
  return (Number.isFinite(h) && h > 0 ? h : 8) * 3_600_000;
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

/** Test-only: clear the registry. */
export function __resetSessionRegistry(): void { users.clear(); }
