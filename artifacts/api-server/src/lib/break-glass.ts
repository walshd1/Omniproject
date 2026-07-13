import type { Request } from "express";
import { constantTimeEqual } from "./crypto-keys";

/**
 * Break-glass containment — an IdP-INDEPENDENT panic button for "a bad actor is impersonating an
 * admin (a stolen/forged admin session, a phished admin login), lock it down NOW".
 *
 * The problem it solves: every normal containment control (revoke sessions, engage the maintenance
 * lockdown, revoke a role-map group) is reached THROUGH an authenticated admin session — the very
 * thing under suspicion. If you can't trust the admin identity, you can't trust the path to fix it.
 * Break-glass is authenticated by a high-entropy LOCAL secret (`BREAK_GLASS_TOKEN`) held out-of-band
 * by the operator, NOT by the IdP — so it works even when the IdP/admin identity is compromised.
 *
 * MINIMAL BLAST RADIUS (assume the break-glass token itself leaks): it can ONLY make the deployment
 * MORE contained — engage read-only lockdown and rotate the session key (log everyone out, fleet-wide)
 * — and release that lockdown. It can NOT read or mutate business data, mint a session, or grant any
 * role. So a leaked break-glass token is a self-inflicted denial-of-service at worst, never a breach.
 * Every use is loudly audited and the endpoints are strictly rate-limited.
 *
 * OFF by default: enabled only when `BREAK_GLASS_TOKEN` is set to a sufficiently strong value.
 */

/** Minimum token length to enable break-glass — a short token would be brute-forceable. */
const MIN_TOKEN_LEN = 24;

/** The configured break-glass token, or null when unset/too weak (⇒ break-glass disabled). */
function configuredToken(): string | null {
  const t = process.env["BREAK_GLASS_TOKEN"]?.trim();
  return t && t.length >= MIN_TOKEN_LEN ? t : null;
}

/** Is break-glass containment enabled (a strong BREAK_GLASS_TOKEN is set)? */
export function breakGlassEnabled(): boolean {
  return configuredToken() !== null;
}

/** Extract the presented break-glass token from the request (`X-Break-Glass-Token` header, or an
 *  `Authorization: Bearer` fallback). */
function presentedToken(req: Request): string | null {
  const hdr = req.headers["x-break-glass-token"];
  const fromHeader = Array.isArray(hdr) ? hdr[0] : hdr;
  if (typeof fromHeader === "string" && fromHeader.trim()) return fromHeader.trim();
  const auth = req.headers["authorization"];
  const bearer = Array.isArray(auth) ? auth[0] : auth;
  if (bearer?.startsWith("Bearer ")) return bearer.slice(7).trim();
  return null;
}

/** Does the request carry the valid break-glass token? Constant-time compare; false when break-glass
 *  is disabled or the token is absent/wrong. Length is checked first so timingSafeEqual never sees
 *  mismatched buffers (which would throw). */
export function hasValidBreakGlassToken(req: Request): boolean {
  const expected = configuredToken();
  if (!expected) return false;
  const presented = presentedToken(req);
  if (!presented) return false;
  return constantTimeEqual(presented, expected);
}
