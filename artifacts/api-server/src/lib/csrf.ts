import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

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
  return /^(1|true|on|yes)$/i.test(process.env["CSRF_DISABLED"]?.trim() ?? "");
}

/** Our own origin(s): PUBLIC_URL, the request's derived origin, + any trusted extras. */
function allowedOrigins(req: Request): Set<string> {
  const out = new Set<string>();
  const pub = process.env["PUBLIC_URL"]?.trim();
  if (pub) out.add(pub.replace(/\/+$/, "").toLowerCase());
  const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0]?.trim() || req.protocol;
  const host = (req.headers["x-forwarded-host"] as string)?.split(",")[0]?.trim() || req.get("host");
  if (host) out.add(`${proto}://${host}`.toLowerCase());
  for (const extra of (process.env["CSRF_TRUSTED_ORIGINS"]?.split(",") ?? [])) {
    const e = extra.trim().replace(/\/+$/, "").toLowerCase();
    if (e) out.add(e);
  }
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

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
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
    secure: process.env["NODE_ENV"] === "production",
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
    if (!cookieTok || !headerTok || !safeEqual(String(cookieTok), String(headerTok))) {
      res.status(403).json({ error: "CSRF: missing or invalid token" });
      return;
    }
  }
  next();
}
