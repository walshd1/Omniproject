import { isDevMode } from "./dev-mode";
import type { Session, Impersonation } from "./oidc";

/**
 * Ephemeral dev-mode impersonation — let a developer act AS another user to
 * reproduce a role-specific issue, with hard guardrails:
 *
 *  - DEV ONLY: `activeImpersonation` returns null unless dev mode is active, so a
 *    stale impersonation cookie is inert in (and after leaving) a dev build, and is
 *    never honoured in production.
 *  - EPHEMERAL: it expires after IMPERSONATION_TTL_MS and is stripped once expired,
 *    so it cannot quietly persist.
 *  - ACCOUNTABLE: it carries the real initiator (`by`) and a required `reason`,
 *    retained on the effective session so every impersonated action is auditable.
 *
 * Starting one requires an explicit, reason-bearing approval (the UI dialog →
 * POST /api/dev-mode/impersonate); these helpers are the pure read side.
 */

export const IMPERSONATION_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** The active impersonation on a session (dev mode + not expired), else null. */
export function activeImpersonation(session: Session | null, now = Date.now()): Impersonation | null {
  const imp = session?.impersonation;
  if (!imp) return null;
  if (!isDevMode()) return null;
  if (imp.expiresAt <= now) return null;
  return imp;
}

/**
 * The effective session: the impersonated identity overlaid when an impersonation
 * is active, otherwise the session with any inert/expired impersonation stripped
 * (so it never leaks downstream).
 */
export function effectiveSession(session: Session | null, now = Date.now()): Session | null {
  if (!session) return null;
  const imp = activeImpersonation(session, now);
  if (!imp) {
    if (session.impersonation) {
      const { impersonation: _drop, ...rest } = session;
      return rest as Session;
    }
    return session;
  }
  return {
    ...session,
    sub: imp.sub,
    email: imp.email ?? session.email,
    name: imp.email ?? imp.sub,
    roles: imp.roles ?? session.roles,
    impersonation: imp, // retained for audit accountability
  };
}
