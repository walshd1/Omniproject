/**
 * Authentication routes + the session helpers the rest of the gateway reads from.
 * Drives the OIDC Authorization-Code-+-PKCE login/callback/logout, mints the
 * signed httpOnly session cookie, and (in demo mode, no IdP) issues a local admin
 * session. `getSession(req)` here is the single source of the caller's identity.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import {
  oidcConfig,
  isOidcConfigured,
  discover,
  randomToken,
  pkceChallenge,
  exchangeCode,
  decodeIdTokenClaims,
  verifyIdToken,
  type Session,
  type Impersonation,
} from "../lib/oidc";
import { roleForReq } from "../lib/rbac";
import { effectiveSession } from "../lib/impersonation";
import { seal, open } from "../lib/session-crypto";
import { isSessionExpired, timeoutPolicy } from "../lib/session-timeout";
import { currentVersion, isActive, userSessionsRevokedAt } from "../lib/key-registry";

const router = Router();

const SESSION_COOKIE = "omni_session";
const FLOW_COOKIE = "omni_oidc_flow";
// Re-seal an active session at most this often (don't re-sign on every request).
const SLIDE_THROTTLE_MS = 60_000;

const cookieBase = {
  httpOnly: true as const,
  signed: true as const,
  sameSite: "lax" as const,
  secure: process.env["NODE_ENV"] === "production",
  path: "/",
};

function baseUrl(req: Request): string {
  const configured = process.env["PUBLIC_URL"]?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

function readSession(req: Request): Session | null {
  const raw = req.signedCookies?.[SESSION_COOKIE];
  if (!raw) return null;
  try {
    // Prefer the sealed (encrypted) payload; fall back to legacy plaintext JSON
    // so existing sessions survive the upgrade (they re-seal on the next write).
    const session = JSON.parse(open(raw) ?? raw) as Session;
    // Idle / absolute timeout: an expired session reads as "no session" everywhere,
    // so every protected route rejects it (limits unattended-session risk).
    if (isSessionExpired(session, Date.now())) return null;
    // Key revocation: a session signed under a revoked session-key version, or a user
    // whose sessions were revoked after this one was issued, is rejected at once.
    if (!isActive("session", session.kver ?? 1)) return null;
    if (session.sub && session.iat && session.iat < userSessionsRevokedAt(session.sub)) return null;
    return session;
  } catch {
    return null;
  }
}

function setSession(res: Response, session: Session): void {
  const now = Date.now();
  // Stamp issue + activity times (preserve the original issue time so the absolute
  // cap can't be reset by activity). Signed (cookie-parser) AND sealed (AES-256-GCM).
  const stamped: Session = { ...session, iat: session.iat ?? now, seen: now, kver: session.kver ?? currentVersion("session") };
  res.cookie(SESSION_COOKIE, seal(JSON.stringify(stamped)), {
    ...cookieBase,
    maxAge: 1000 * 60 * 60 * 8, // 8h
  });
}

/**
 * Slide the idle timeout forward on activity: re-stamp `seen` (throttled) so an active
 * user stays signed in, and tidy up an expired/garbage session cookie. Mounted early,
 * after the cookie parser, so it runs before any route reads the session.
 */
export function slideSession(req: Request, res: Response, next: NextFunction): void {
  const raw = req.signedCookies?.[SESSION_COOKIE];
  if (raw) {
    const session = readSession(req); // null when expired or unreadable
    if (!session) {
      res.clearCookie(SESSION_COOKIE, cookieBase);
    } else if (!session.iat || !session.seen || Date.now() - session.seen > SLIDE_THROTTLE_MS) {
      setSession(res, session);
    }
  }
  next();
}

// Exposed so other routes (e.g. the n8n proxy) can pull the bearer token. Applies
// any active (dev-only, non-expired) impersonation, so the whole app — incl. RBAC —
// sees the impersonated identity. The raw session is available via getRealSession.
export function getSession(req: Request): Session | null {
  return effectiveSession(readSession(req));
}

/** The REAL signed-in session, ignoring any impersonation — used to authorise
 *  starting/stopping an impersonation against the genuine actor. */
export function getRealSession(req: Request): Session | null {
  return readSession(req);
}

/** Begin an ephemeral impersonation on the current session (overwrites any prior
 *  one). Returns false if there is no session to attach it to. */
export function startImpersonation(req: Request, res: Response, imp: Impersonation): boolean {
  const real = readSession(req);
  if (!real) return false;
  setSession(res, { ...real, impersonation: imp });
  return true;
}

/** Clear any impersonation from the current session. */
export function stopImpersonation(req: Request, res: Response): void {
  const real = readSession(req);
  if (!real) return;
  const { impersonation: _drop, ...rest } = real;
  setSession(res, rest as Session);
}

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get("/auth/me", (req, res) => {
  const session = readSession(req);
  if (session) {
    res.json({
      authenticated: true,
      mode: isOidcConfigured ? "oidc" : "demo",
      user: { sub: session.sub, name: session.name, email: session.email },
      role: roleForReq(req),
      // Lets the SPA warn before, and redirect on, an idle/absolute timeout.
      sessionTimeout: timeoutPolicy(),
    });
    return;
  }
  res.json({ authenticated: false, mode: isOidcConfigured ? "oidc" : "demo", user: null, role: "viewer" });
});

// ── GET /api/auth/login ───────────────────────────────────────────────────────
router.get("/auth/login", async (req, res) => {
  const returnTo = typeof req.query["returnTo"] === "string" ? req.query["returnTo"] : "/";

  // Demo mode: no IdP configured — establish a local demo session.
  if (!oidcConfig) {
    setSession(res, { sub: "demo-user", name: "Demo User", email: "demo@omniproject.local", accessToken: "demo-token" });
    res.redirect(returnTo);
    return;
  }

  try {
    const discovery = await discover(oidcConfig);
    const state = randomToken();
    const verifier = randomToken(48);
    const redirectUri = `${baseUrl(req)}/api/auth/callback`;

    res.cookie(FLOW_COOKIE, JSON.stringify({ state, verifier, returnTo }), {
      ...cookieBase,
      maxAge: 1000 * 60 * 10, // 10 min
    });

    const authUrl = new URL(discovery.authorization_endpoint);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", oidcConfig.clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", oidcConfig.scope);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", pkceChallenge(verifier));
    authUrl.searchParams.set("code_challenge_method", "S256");

    res.redirect(authUrl.toString());
  } catch (err) {
    req.log.error({ err }, "OIDC login initiation failed");
    res.status(502).send("SSO is temporarily unavailable. Check OIDC configuration.");
  }
});

// ── GET /api/auth/callback ────────────────────────────────────────────────────
router.get("/auth/callback", async (req, res) => {
  if (!oidcConfig) {
    res.redirect("/");
    return;
  }

  const flowRaw = req.signedCookies?.[FLOW_COOKIE];
  res.clearCookie(FLOW_COOKIE, cookieBase);

  if (!flowRaw) {
    res.status(400).send("Login session expired. Please try again.");
    return;
  }

  const { state, verifier, returnTo } = JSON.parse(flowRaw) as {
    state: string;
    verifier: string;
    returnTo: string;
  };

  if (req.query["error"]) {
    req.log.warn({ error: req.query["error"] }, "OIDC provider returned an error");
    res.status(401).send(`SSO error: ${String(req.query["error"])}`);
    return;
  }

  if (typeof req.query["code"] !== "string" || req.query["state"] !== state) {
    res.status(400).send("Invalid SSO callback (state mismatch).");
    return;
  }

  try {
    const discovery = await discover(oidcConfig);
    const tokens = await exchangeCode({
      config: oidcConfig,
      discovery,
      code: req.query["code"],
      redirectUri: `${baseUrl(req)}/api/auth/callback`,
      codeVerifier: verifier,
    });

    if (!tokens.id_token) {
      res.status(502).send("SSO did not return an ID token.");
      return;
    }

    // Cryptographically verify the ID token (signature + iss/aud/exp) before
    // trusting any of its claims.
    await verifyIdToken(tokens.id_token, oidcConfig, discovery);

    const claims = decodeIdTokenClaims(tokens.id_token);

    setSession(res, {
      sub: claims?.sub || "unknown",
      name: claims?.name,
      email: claims?.email,
      roles: claims?.roles,
      accessToken: tokens.access_token,
      idToken: tokens.id_token,
    });

    res.redirect(returnTo || "/");
  } catch (err) {
    req.log.error({ err }, "OIDC token exchange failed");
    res.status(502).send("SSO token exchange failed. Please try again.");
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post("/auth/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE, cookieBase);
  res.json({ ok: true });
});

export default router;
