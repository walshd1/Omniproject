import type { Request, Response, NextFunction } from "express";
import { getSession } from "../routes/auth";

/**
 * Step-up (re-authentication) for the highest-risk actions (security item D).
 *
 * Holding a valid session is not enough to revoke a key, flip an egress/governance
 * setting, or run the raw escape hatch: the actor must have RE-AUTHENTICATED recently.
 * This shrinks the blast radius of a hijacked-but-idle session or shoulder-surfed tab —
 * a stolen session can read, but can't perform a sensitive action without passing a
 * fresh auth challenge whose freshness window is short.
 *
 * Freshness is stamped on the session as `stepUpAt` by POST/GET /api/auth/step-up
 * (a genuine IdP re-auth with prompt=login in OIDC mode; a confirm in demo mode), and
 * checked here. Stateless — the marker rides the sealed session cookie, nothing stored.
 */
const DEFAULT_WINDOW_MIN = 5;

/** How long a step-up stays fresh (STEP_UP_MINUTES, default 5). */
export function stepUpWindowMs(): number {
  const raw = Number(process.env["STEP_UP_MINUTES"]?.trim());
  const min = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_WINDOW_MIN;
  return min * 60_000;
}

/** Has this session re-authenticated within the freshness window? An impossible-travel
 *  flag (lib/impossible-travel.ts) raised AFTER the last step-up invalidates it — the
 *  holder must re-verify with a step-up minted after the flag before it counts as fresh
 *  again, regardless of how recently they last stepped up before the flag was raised. */
export function stepUpFresh(session: { stepUpAt?: number; impossibleTravelAt?: number } | null | undefined, now: number): boolean {
  if (!session?.stepUpAt || now - session.stepUpAt >= stepUpWindowMs()) return false;
  if (session.impossibleTravelAt && session.impossibleTravelAt > session.stepUpAt) return false;
  return true;
}

/**
 * Middleware: require a fresh step-up. 401 when unauthenticated; 403 with
 * `code: "step_up_required"` when authenticated but stale, so the SPA can prompt a
 * re-auth and retry. Mount AFTER the role gate (requireRole) on a sensitive route.
 */
export function requireStepUp(req: Request, res: Response, next: NextFunction): void {
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: "authentication required" }); return; }
  if (!stepUpFresh(session, Date.now())) {
    res.status(403).json({ error: "recent re-authentication required for this action", code: "step_up_required", windowMs: stepUpWindowMs() });
    return;
  }
  next();
}
