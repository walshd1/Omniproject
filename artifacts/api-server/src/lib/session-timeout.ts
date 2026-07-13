import type { Session } from "./oidc";

/**
 * Session timeout policy — a sliding IDLE timeout plus an ABSOLUTE lifetime cap.
 *
 * The idle timeout limits unattended-session / shoulder-surfing risk: a session that
 * hasn't been used for `idleMs` is dead server-side, regardless of the cookie's own
 * expiry. The absolute cap (from `iat`) bounds the total session age even for an
 * always-active user, so a stolen long-lived cookie can't live forever.
 *
 * Enforcement is server-side: an expired session reads as "no session" everywhere, so
 * every protected route rejects it. Active sessions are slid forward (see auth.ts).
 *
 * Defaults are deliberately SHORT so that piggybacking a stolen-but-live session doesn't
 * really work: a short idle window kills an unattended session fast (the usual hijack
 * scenario — the cookie is used while the real user is away), and a short absolute cap
 * forces a genuine re-authentication within a working half-day even for an always-active
 * holder. The highest-risk actions additionally demand a FRESH step-up (see lib/step-up),
 * so a live-session holder still can't reach them without re-proving identity.
 *
 * Config (env): SESSION_IDLE_MINUTES (default 15; 0 disables idle),
 *               SESSION_ABSOLUTE_HOURS (default 4; 0 disables the cap).
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Security-first defaults — short, to bound a live-session-piggyback window. Kept in one place
 *  and re-exported so the cookie lifetime (routes/auth, lib/csrf) tracks the same absolute cap. */
export const DEFAULT_IDLE_MINUTES = 15;
export const DEFAULT_ABSOLUTE_HOURS = 4;

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Idle timeout in ms (0 = disabled). */
export function idleMs(): number {
  return envNumber("SESSION_IDLE_MINUTES", DEFAULT_IDLE_MINUTES) * MINUTE;
}

/** Absolute session lifetime in ms (0 = disabled). */
export function absoluteMs(): number {
  return envNumber("SESSION_ABSOLUTE_HOURS", DEFAULT_ABSOLUTE_HOURS) * HOUR;
}

/** The session-cookie max-age the browser should use: the absolute cap when set, else a bounded
 *  fallback (the absolute cap can be env-disabled, but the cookie must still not live forever).
 *  Shared by routes/auth + lib/csrf so all three lifetimes stay in lock-step. */
export function sessionCookieMaxAgeMs(): number {
  const absolute = absoluteMs();
  return absolute > 0 ? absolute : DEFAULT_ABSOLUTE_HOURS * HOUR;
}

/**
 * Has this session expired by idle or absolute age at `now`? Missing timestamps are
 * treated as NOT expired so pre-upgrade cookies survive — they get stamped on the next
 * request and are enforced from then on (see auth.ts slideSession).
 */
export function isSessionExpired(session: Session, now: number): boolean {
  const idle = idleMs();
  if (idle > 0 && typeof session.seen === "number" && now - session.seen > idle) return true;
  const absolute = absoluteMs();
  if (absolute > 0 && typeof session.iat === "number" && now - session.iat > absolute) return true;
  return false;
}

/** Public view of the policy, for the frontend idle warning / countdown. */
export function timeoutPolicy(): { idleMs: number; absoluteMs: number } {
  return { idleMs: idleMs(), absoluteMs: absoluteMs() };
}
