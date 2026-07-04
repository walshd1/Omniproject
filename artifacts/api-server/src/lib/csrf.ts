import { randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { envFlag } from "./env";
import { requireTls } from "./deployment-profile";
import { constantTimeEqual } from "./crypto-keys";
import { configuredCorsOrigins } from "./origin-allowlist";
import { firstForwardedValue } from "./trust-proxy";

/**
 * CSRF hardening for cookie-authenticated mutations (security item B).
 *
 * The session cookie is SameSite=Lax already — a strong baseline. This adds
 * defence-in-depth, scoped to requests that ride the ambient session cookie:
 *
 *  1. Origin/Referer check — if the request announces where it came from, it MUST
 *     be our own origin. This is the primary defence: a cross-site `fetch`/XHR
 *     always carries an attacker Origin, which we reject.
 *  2. Double-submit token — a non-httpOnly `omni_csrf` cookie echoed in an
 *     `X-CSRF-Token` header; required for BROWSER-driven requests. A cross-site
 *     HTML form can't set a custom header and can't read our cookie, so it's
 *     blocked even when it omits Origin.
 *
 * Scope: only UNSAFE methods (POST/PUT/PATCH/DELETE) on `/api`, and only when the
 * session cookie is present. Machine callers (broker, webhook ingest, MCP, API
 * tokens) authenticate with their own bearer secret and carry no session cookie,
 * so they're naturally exempt — CSRF only targets ambient browser credentials.
 *
 * "Browser-driven" is decided by `Sec-Fetch-Site` (a forbidden header the page's
 * JS cannot forge) or the presence of Origin/Referer. A request with NONE of
 * these is not a browser navigation (curl/server-to-server), so it cannot be a
 * CSRF vector and the token isn't demanded — only the Origin check, which it
 * passes by having no cross-origin marker.
 */
const CSRF_COOKIE = "omni_csrf";
const SESSION_COOKIE = "omni_session";
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/** Off-switch for emergencies / unusual proxies (logged at boot by the self-check). */
function disabled(): boolean {
  return envFlag("CSRF_DISABLED");
}

/** Our own origin(s): PUBLIC_URL / CORS_ALLOWED_ORIGINS / CSRF_TRUSTED_ORIGINS (shared with the
 *  CORS allowlist — see lib/origin-allowlist.ts), plus the request's own derived origin. */
function allowedOrigins(req: Request): Set<string> {
  const out = configuredCorsOrigins();
  const proto = firstForwardedValue(req, "x-forwarded-proto") || req.protocol;
  const host = firstForwardedValue(req, "x-forwarded-host") || req.get("host");
  if (host) out.add(`${proto}://${host}`.toLowerCase());
  return out;
}

/** The origin a request announces (Origin header, else the Referer's origin). */
function announcedOrigin(req: Request): string | null {
  const origin = req.headers["origin"];
  if (typeof origin === "string" && origin && origin !== "null") return origin.toLowerCase();
  const referer = req.headers["referer"];
  if (typeof referer === "string" && referer) {
    try { return new URL(referer).origin.toLowerCase(); } catch { /* malformed */ }
  }
  return null;
}

/** Mint a fresh CSRF token (hex). */
export function newCsrfToken(): string {
  return randomBytes(24).toString("hex");
}

/** Set the double-submit cookie (readable by the SPA's JS so it can echo the header). */
export function setCsrfCookie(res: Response, token: string): void {
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false, // the SPA must read it to echo X-CSRF-Token
    sameSite: "lax",
    secure: requireTls(), // mirror the session cookie's Secure decision (TLS-aware, not NODE_ENV)
    path: "/",
    maxAge: 1000 * 60 * 60 * 8, // mirror the session lifetime
  });
}

/** Ensure a session-bearing request has a CSRF token; mint one if absent (upgrade path). */
export function ensureCsrfCookie(req: Request, res: Response): void {
  if (!req.signedCookies?.[SESSION_COOKIE]) return;
  if (!req.cookies?.[CSRF_COOKIE]) setCsrfCookie(res, newCsrfToken());
}

/** The CSRF guard middleware (mount after cookieParser + slideSession). */
export function csrfGuard(req: Request, res: Response, next: NextFunction): void {
  if (SAFE.has(req.method) || disabled() || !req.path.startsWith("/api")) { next(); return; }
  // Only ambient-cookie requests are CSRF-able; bearer/secret callers carry no session cookie.
  if (!req.signedCookies?.[SESSION_COOKIE]) { next(); return; }

  // 1) Origin/Referer must be us, if the request announces one.
  const origin = announcedOrigin(req);
  if (origin && !allowedOrigins(req).has(origin)) {
    res.status(403).json({ error: "CSRF: cross-origin request rejected" });
    return;
  }

  // 2) Browser-driven requests must present the double-submit token.
  const secFetch = req.headers["sec-fetch-site"];
  const browserDriven = !!origin || (typeof secFetch === "string" && secFetch !== "" && secFetch !== "none");
  if (browserDriven) {
    const cookieTok = req.cookies?.[CSRF_COOKIE];
    const headerTok = req.get("x-csrf-token");
    if (!cookieTok || !headerTok || !constantTimeEqual(String(cookieTok), String(headerTok))) {
      res.status(403).json({ error: "CSRF: missing or invalid token" });
      return;
    }
  }
  next();
}
