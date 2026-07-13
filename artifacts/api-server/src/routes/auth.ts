/**
 * Authentication routes + the session helpers the rest of the gateway reads from.
 * Drives the OIDC Authorization-Code-+-PKCE login/callback/logout, mints the
 * signed httpOnly session cookie, and (in demo mode, no IdP) issues a local admin
 * session. `getSession(req)` here is the single source of the caller's identity.
 */
import { randomBytes } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import {
  isOidcConfigured,
  getOidcProvider,
  oidcProviderList,
  discoverConfig,
  randomToken,
  buildOidcAuthUrl,
  completeOidcLogin,
  type Session,
  type Impersonation,
} from "../lib/oidc";
import { roleForReq } from "../lib/rbac";
import { isSamlConfigured, samlConfigStatus, samlLoginUrl, validateSamlResponse, samlMetadata } from "../lib/saml";
import {
  isOAuth2Configured,
  oauth2Config,
  buildAuthUrl,
  completeOAuth2Login,
  fetchUserInfo,
  mapUserInfo,
  newOAuth2Flow,
} from "../lib/oauth2";
import { magicLinkEnabled, isValidEmail, mintMagicToken, verifyMagicToken, consumeMagicToken, sendMagicLink } from "../lib/magic-link";
import { isDevMode } from "../lib/dev-mode";
import { isDemoAuth } from "../lib/auth-config";
import { effectiveSession } from "../lib/impersonation";
import { seal, open } from "../lib/session-crypto";
import { isSessionExpired, timeoutPolicy, sessionCookieMaxAgeMs } from "../lib/session-timeout";
import { currentVersion, isActive, userSessionsRevokedAt } from "../lib/key-registry";
import { registerSession } from "../lib/session-registry";
import { requireTls } from "../lib/deployment-profile";
import { productionSignals } from "../lib/dev-mode-guard";
import { ensureCsrfCookie, setCsrfCookie, newCsrfToken } from "../lib/csrf";
import { checkLogin } from "../lib/impossible-travel";
import { recordAudit } from "../lib/audit";
import { stepUpFresh, stepUpWindowMs } from "../lib/step-up";

const router = Router();

/** Check a fresh login for implausible travel from the same principal's last login in
 *  this process, audit-log it loudly if flagged, and return the session patch to merge
 *  in (empty object when clean). Shared by every real-identity login path (OIDC, SAML,
 *  OAuth2, magic-link) — demo mode is exempt (see lib/impossible-travel.ts's caller
 *  contract; demo's single shared "demo-user" identity has no real location to protect). */
async function travelCheck(sub: string, email: string | undefined, ip: string | undefined): Promise<{ impossibleTravelAt?: number }> {
  const result = await checkLogin(sub, ip);
  if (!result.flagged) return {};
  recordAudit({
    ts: new Date().toISOString(),
    category: "auth",
    action: "impossible_travel_flagged",
    actor: { sub, email },
    status: 200,
    write: false,
    meta: {
      distanceKm: result.distanceKm,
      speedKmh: result.speedKmh,
      minutesElapsed: result.minutesElapsed,
      fromCountry: result.fromCountry,
      toCountry: result.toCountry,
      ip,
    },
  });
  return { impossibleTravelAt: Date.now() };
}

const SESSION_COOKIE = "omni_session";
const FLOW_COOKIE = "omni_oidc_flow";
const OAUTH2_FLOW_COOKIE = "omni_oauth2_flow";
// Binds a SAML step-up round-trip to the initiating principal: the SAML ACS only stamps step-up
// freshness when the re-authenticated `sub` matches the one that began the flow (OAuth2 carries the
// same binding inside its own flow cookie; OIDC uses its flow cookie's `stepup` + auth_time).
const STEPUP_COOKIE = "omni_stepup_flow";
// Re-seal an active session at most this often (don't re-sign on every request).
const SLIDE_THROTTLE_MS = 60_000;
// Session cookie lifetime tracks the ABSOLUTE session cap (lib/session-timeout.sessionCookieMaxAgeMs),
// so shortening SESSION_ABSOLUTE_HOURS also shortens the browser cookie — the server-side idle/absolute
// enforcement is authoritative regardless, but keeping them in lock-step means the cookie disappears
// when the session dies. lib/csrf.ts uses the SAME helper.
/** OAuth/magic-link flow-cookie lifetime (10 min) — the in-flight auth handshake window. */
const FLOW_COOKIE_TTL_MS = 1000 * 60 * 10;

// The shared cookie attributes. `secure` is computed FRESH on every call (the single source
// of the flag) so a runtime deployment-profile change applies to the next set/clear alike —
// no stale module-load value, no per-call override. Secure follows the deployment's TLS
// posture, NOT raw NODE_ENV, so a self-hoster / charity can run a production-stable instance
// on plain HTTP (LAN) without breaking sessions.
function cookieBase() {
  return {
    httpOnly: true as const,
    signed: true as const,
    sameSite: "lax" as const,
    secure: requireTls(),
    path: "/",
  };
}

/** Thrown by `resolveBaseUrl` when a production-like deployment has no `PUBLIC_URL` — building
 *  a security-sensitive link (magic-link, OAuth/OIDC redirect) from a client-supplied Host
 *  header would let a request forger poison it. The route's own error handling turns this into
 *  a safe generic 500, never the raw client-supplied value. */
export class InsecureBaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsecureBaseUrlError";
  }
}

/**
 * Pure decision for the gateway's own public base URL, used to construct every security-
 * sensitive link (magic-link verification, OAuth2/OIDC redirect URIs). Exported (and kept
 * request-free) so the policy is unit-testable without an Express `Request`.
 *
 * `PUBLIC_URL` is always authoritative when set. When it's NOT set, a client-supplied `Host` /
 * `X-Forwarded-Host` header is NEVER safe to trust blindly — either header is just a string the
 * caller chose, and an attacker can spoof it on the very request that triggers a magic-link
 * email to a VICTIM, poisoning the link the victim receives with an attacker-controlled domain
 * (classic host-header-injection account takeover). So:
 *   - In a production-like deployment (real SSO configured, a licence, etc. — the SAME detector
 *     `session-secret-guard.ts`/`requireTls()` use for the equivalent class of gap), missing
 *     `PUBLIC_URL` is a hard failure, not a silent header-trusting fallback.
 *   - In dev/demo (no production signals), a fallback is kept for local convenience, but
 *     `X-Forwarded-*` is honoured ONLY when the operator has explicitly opted into trusting a
 *     reverse proxy (`req.app.get("trust proxy")`) — otherwise even those are just more
 *     client-supplied strings.
 */
export function resolveBaseUrl(opts: {
  configured: string | undefined;
  productionLike: boolean;
  trustProxy: boolean;
  forwardedProto: string | undefined;
  forwardedHost: string | undefined;
  reqProtocol: string;
  rawHost: string | undefined;
}): string {
  const configured = opts.configured?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (opts.productionLike) {
    throw new InsecureBaseUrlError(
      "PUBLIC_URL must be set in a production deployment — building magic-link/OAuth redirect " +
        "URLs from a client-supplied Host header is unsafe (host-header injection).",
    );
  }
  const proto = (opts.trustProxy ? opts.forwardedProto?.split(",")[0]?.trim() : undefined) || opts.reqProtocol;
  const host = (opts.trustProxy ? opts.forwardedHost : undefined) || opts.rawHost;
  return `${proto}://${host}`;
}

/** The gateway's own public base URL for THIS request — see `resolveBaseUrl` for
 *  the hardening. Shared by every route that must build an absolute self-URL
 *  (OIDC/OAuth2 redirects and magic links here; OData/discovery/IdP-setup
 *  elsewhere), so the host-header-injection guard lives in exactly one place. */
export function baseUrl(req: Request): string {
  return resolveBaseUrl({
    configured: process.env["PUBLIC_URL"],
    productionLike: process.env["NODE_ENV"] === "production" || productionSignals(process.env).length > 0,
    trustProxy: !!req.app.get("trust proxy"),
    forwardedProto: req.headers["x-forwarded-proto"] as string | undefined,
    forwardedHost: req.headers["x-forwarded-host"] as string | undefined,
    reqProtocol: req.protocol,
    rawHost: req.get("host"),
  });
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
    // Concurrent-session cap: a session pushed outside MAX_SESSIONS_PER_USER (an older login
    // once the user signs in beyond the limit) reads as signed-out. No-op when the cap is unset
    // or the session predates salting. Keyed by the stable per-session salt.
    if (session.sub && session.salt && !registerSession(session.sub, session.salt, Date.now())) return null;
    return session;
  } catch {
    return null;
  }
}

function setSession(res: Response, session: Session): void {
  const now = Date.now();
  // Stamp issue + activity times (preserve the original issue time so the absolute
  // cap can't be reset by activity). Signed (cookie-parser) AND sealed (AES-256-GCM).
  // `smono` + `salt` are minted ONCE per session (preserved across re-seals like iat),
  // so the per-session broker key (lib/session-key) is fresh on each login but stable
  // for the life of the session: the monotonic reading is the non-rewindable session
  // start time; the salt is CSPRNG entropy that survives a process-clock reset.
  const stamped: Session = {
    ...session,
    iat: session.iat ?? now,
    seen: now,
    kver: session.kver ?? currentVersion("session"),
    smono: session.smono ?? process.hrtime.bigint().toString(),
    salt: session.salt ?? randomBytes(16).toString("hex"),
  };
  res.cookie(SESSION_COOKIE, seal(JSON.stringify(stamped)), {
    ...cookieBase(), // secure is evaluated here, so a wizard profile change applies to new sessions
    maxAge: sessionCookieMaxAgeMs(),
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
      res.clearCookie(SESSION_COOKIE, cookieBase());
      res.clearCookie("omni_csrf", { ...cookieBase(), httpOnly: false, signed: false });
    } else {
      if (!session.iat || !session.seen || Date.now() - session.seen > SLIDE_THROTTLE_MS) setSession(res, session);
      // Make sure an active session always has a CSRF token to echo (upgrade path).
      ensureCsrfCookie(req, res);
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
      // Currently-unresolved impossible-travel flag (cleared by a step-up minted AFTER
      // it was raised — see stepUpFresh) — the SPA prompts a re-verification while true.
      impossibleTravel: !!session.impossibleTravelAt && !stepUpFresh(session, Date.now()),
      samlConfigured: isSamlConfigured(),
      // Surfaces a PARTIALLY-configured SAML rollout (what's still missing) so IT can self-diagnose.
      samlStatus: samlConfigStatus(),
      oauth2Configured: isOAuth2Configured,
    });
    return;
  }
  res.json({ authenticated: false, mode: isOidcConfigured ? "oidc" : "demo", user: null, role: "viewer", samlConfigured: isSamlConfigured(), samlStatus: samlConfigStatus(), oauth2Configured: isOAuth2Configured, magicLinkEnabled: magicLinkEnabled() });
});

/** Sanitise a post-auth `returnTo` to a SAME-ORIGIN path — prevents open redirects (CWE-601).
 *  Accepts only a path starting with a single "/"; anything absolute, protocol-relative ("//"
 *  or "/\\"), or carrying control chars falls back to "/". */
export function safeLocalPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(value)) return "/"; // CR/LF/control smuggling
  return value;
}

// ── GET /api/auth/login ───────────────────────────────────────────────────────
// A strict per-IP ceiling (loginLimiter) is applied at the router mount in routes/index.ts.
router.get("/auth/login", async (req, res) => {
  const returnTo = safeLocalPath(req.query["returnTo"]);
  const provider = getOidcProvider(typeof req.query["provider"] === "string" ? req.query["provider"] : null);

  // Demo mode: no IdP configured — establish a local demo session.
  if (!provider) {
    setSession(res, { sub: "demo-user", name: "Demo User", email: "demo@omniproject.local", accessToken: "demo-token" });
    setCsrfCookie(res, newCsrfToken()); // fresh CSRF token per login (rotation)
    res.redirect(returnTo);
    return;
  }

  try {
    const config = await discoverConfig(provider);
    const state = randomToken();
    const verifier = randomToken(48);
    // OIDC nonce: bound into the auth request and echoed back in the ID token, so a
    // replayed/injected token minted for a different login is rejected at the callback.
    const nonce = randomToken();
    const redirectUri = `${baseUrl(req)}/api/auth/callback`;

    // The flow cookie carries the provider id so the callback verifies against the SAME provider.
    res.cookie(FLOW_COOKIE, JSON.stringify({ state, verifier, nonce, returnTo, provider: provider.id }), {
      ...cookieBase(),
      maxAge: FLOW_COOKIE_TTL_MS,
    });

    res.redirect(await buildOidcAuthUrl({ config, provider, redirectUri, state, nonce, verifier }));
  } catch (err) {
    req.log.error({ err }, "OIDC login initiation failed");
    res.status(502).send("SSO is temporarily unavailable. Check OIDC configuration.");
  }
});

// ── GET /api/auth/callback ────────────────────────────────────────────────────
router.get("/auth/callback", async (req, res) => {
  if (!isOidcConfigured) {
    res.redirect("/");
    return;
  }

  const flowRaw = req.signedCookies?.[FLOW_COOKIE];
  res.clearCookie(FLOW_COOKIE, cookieBase());

  if (!flowRaw) {
    res.status(400).send("Login session expired. Please try again.");
    return;
  }

  const { state, verifier, nonce, returnTo, stepup, provider: providerId } = JSON.parse(flowRaw) as {
    state: string;
    verifier: string;
    nonce?: string;
    returnTo: string;
    stepup?: boolean;
    provider?: string;
  };

  // Resolve the SAME provider the flow began with (the flow cookie is signed/sealed).
  const provider = getOidcProvider(providerId);
  if (!provider) {
    res.status(400).send("Login session expired. Please try again.");
    return;
  }

  if (req.query["error"]) {
    req.log.warn({ error: req.query["error"] }, "OIDC provider returned an error");
    res.status(401).send(`SSO error: ${String(req.query["error"])}`);
    return;
  }

  if (typeof req.query["code"] !== "string" || req.query["state"] !== state) {
    res.status(400).send("Invalid SSO callback (state mismatch).");
    return;
  }
  // An OIDC flow always mints a nonce; its absence means the flow cookie isn't ours — fail closed.
  if (!nonce) {
    res.status(401).send("Invalid SSO callback (nonce missing).");
    return;
  }

  try {
    const config = await discoverConfig(provider);
    // openid-client exchanges the code + validates the ID token end-to-end: signature (issuer JWKS),
    // iss/aud/exp, and the state + nonce bindings. A mismatch throws (caught below → 401).
    const currentUrl = new URL(`${baseUrl(req)}/api/auth/callback${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`);
    const result = await completeOidcLogin({ config, currentUrl, expectedState: state, expectedNonce: nonce, verifier });
    const claims = result.user;

    // Step-up freshness: only grant it if the id_token proves a REAL re-authentication just happened.
    // The step-up authorize request sends prompt=login + max_age=0, so a compliant IdP returns an
    // `auth_time` within the step-up window. If it's absent or stale (the IdP silently reused an SSO
    // session), do NOT stamp stepUpAt — otherwise "step-up" would be a re-auth in name only.
    let stepUpFreshGranted = false;
    if (stepup) {
      stepUpFreshGranted = result.authTime != null && Date.now() - result.authTime * 1000 < stepUpWindowMs();
      if (!stepUpFreshGranted) {
        req.log.warn({ sub: claims.sub, authTime: result.authTime }, "step-up completed without a fresh auth_time — not granting step-up freshness (IdP may have reused an existing session)");
      }
    }

    const travel = await travelCheck(claims.sub || "unknown", claims.email, req.ip);

    setSession(res, {
      sub: claims.sub || "unknown",
      name: claims.name,
      email: claims.email,
      roles: claims.roles,
      amr: claims.amr,
      acr: claims.acr,
      accessToken: result.accessToken,
      ...(result.idToken ? { idToken: result.idToken } : {}),
      // A step-up re-auth (prompt=login) stamps freshness so a sensitive action proceeds — but only
      // when auth_time confirmed a genuine re-authentication (see above).
      ...(stepUpFreshGranted ? { stepUpAt: Date.now() } : {}),
      ...travel,
    });
    setCsrfCookie(res, newCsrfToken()); // fresh CSRF token per login (rotation)

    res.redirect(safeLocalPath(returnTo));
  } catch (err) {
    req.log.error({ err }, "OIDC token exchange failed");
    res.status(502).send("SSO token exchange failed. Please try again.");
  }
});

// ── SAML 2.0 SSO (optional; alongside OIDC) ──────────────────────────────────────
// SP-initiated login: redirect to the IdP. RelayState round-trips the (sanitised) returnTo.
// A strict per-IP loginLimiter is applied at the router mount in routes/index.ts.
router.get("/auth/saml/login", async (req, res) => {
  if (!isSamlConfigured()) { res.status(404).send("SAML SSO is not configured."); return; }
  const returnTo = safeLocalPath(req.query["returnTo"]);
  try {
    const url = await samlLoginUrl(returnTo);
    if (!url) { res.status(503).send("SAML SSO is unavailable (provider library not installed)."); return; }
    res.redirect(url);
  } catch (err) {
    req.log.error({ err }, "SAML login initiation failed");
    res.status(502).send("SAML SSO is temporarily unavailable.");
  }
});

// Assertion Consumer Service (ACS): the IdP POSTs the signed SAMLResponse here (HTTP-POST
// binding). node-saml validates signature + audience + conditions; a valid assertion
// establishes the session. No CSRF token: this is a cross-origin top-level POST from the IdP
// and its trust rests entirely on the signed assertion (the csrf guard exempts the no-session
// first login). The assertion's group attributes flow into the SAME role-map as OIDC claims.
router.post("/auth/saml/callback", async (req, res) => {
  if (!isSamlConfigured()) { res.redirect("/"); return; }
  const body = (req.body ?? {}) as { SAMLResponse?: unknown; RelayState?: unknown };
  if (typeof body.SAMLResponse !== "string") { res.status(400).send("Missing SAMLResponse."); return; }
  try {
    const claims = await validateSamlResponse(body.SAMLResponse);
    if (!claims) { res.status(503).send("SAML SSO is unavailable (provider library not installed)."); return; }
    // Step-up: grant freshness ONLY when this ForceAuthn re-auth is the same principal that began the
    // step-up flow (bound via the signed step-up cookie). A login for a different sub never stamps it.
    const stepUp = readStepUpFlow(req);
    const grantStepUp = !!stepUp && stepUp.sub === claims.sub;
    if (stepUp) res.clearCookie(STEPUP_COOKIE, cookieBase());
    const travel = await travelCheck(claims.sub, claims.email, req.ip);
    setSession(res, {
      sub: claims.sub,
      ...(claims.name !== undefined ? { name: claims.name } : {}),
      ...(claims.email !== undefined ? { email: claims.email } : {}),
      ...(claims.roles.length ? { roles: claims.roles } : {}),
      ...(claims.acr !== undefined ? { acr: claims.acr } : {}),
      // SAML asserts identity, not a backend bearer (see lib/saml HONEST SCOPE).
      accessToken: "saml",
      ...(grantStepUp ? { stepUpAt: Date.now() } : {}),
      ...travel,
    });
    setCsrfCookie(res, newCsrfToken()); // fresh CSRF token per login (rotation)
    res.redirect(safeLocalPath(grantStepUp ? stepUp.returnTo : (typeof body.RelayState === "string" ? body.RelayState : "/")));
  } catch (err) {
    req.log.warn({ err }, "SAML assertion validation failed");
    res.status(401).send("SAML authentication failed (invalid assertion).");
  }
});

// SP metadata XML, so an IdP admin can configure the integration. Public (no secrets).
router.get("/auth/saml/metadata", async (_req, res) => {
  if (!isSamlConfigured()) { res.status(404).send("SAML SSO is not configured."); return; }
  const xml = await samlMetadata();
  if (!xml) { res.status(503).send("SAML SSO is unavailable (provider library not installed)."); return; }
  res.type("application/xml").send(xml);
});

// ── Generic OAuth 2.0 (Authorization Code + PKCE) for NON-OIDC providers (e.g. GitHub) ───
// Off unless the OAUTH2_* env is configured. A strict per-IP loginLimiter is applied at the
// router mount in routes/index.ts.
router.get("/auth/oauth2/login", async (req, res) => {
  if (!oauth2Config) { res.status(404).send("OAuth2 sign-in is not configured."); return; }
  const returnTo = safeLocalPath(req.query["returnTo"]);
  const { state, verifier } = newOAuth2Flow();
  res.cookie(OAUTH2_FLOW_COOKIE, JSON.stringify({ state, verifier, returnTo }), {
    ...cookieBase(),
    maxAge: FLOW_COOKIE_TTL_MS,
  });
  const redirectUri = `${baseUrl(req)}/api/auth/oauth2/callback`;
  res.redirect(await buildAuthUrl({ config: oauth2Config, redirectUri, state, codeVerifier: verifier }));
});

// Callback: validate state, exchange the code (with the PKCE verifier) for an access token,
// fetch the provider's userinfo, map it to a session user, and mint the SAME session cookie as
// every other auth path. The userinfo's role/group field flows into the SAME role-map as OIDC.
router.get("/auth/oauth2/callback", async (req, res) => {
  if (!oauth2Config) { res.redirect("/"); return; }

  const flowRaw = req.signedCookies?.[OAUTH2_FLOW_COOKIE];
  res.clearCookie(OAUTH2_FLOW_COOKIE, cookieBase());
  if (!flowRaw) { res.status(400).send("Login session expired. Please try again."); return; }

  const { state, verifier, returnTo, stepup, sub: stepUpSub } = JSON.parse(flowRaw) as { state: string; verifier: string; returnTo: string; stepup?: boolean; sub?: string };

  if (req.query["error"]) {
    req.log.warn({ error: req.query["error"] }, "OAuth2 provider returned an error");
    res.status(401).send(`OAuth2 error: ${String(req.query["error"])}`);
    return;
  }
  if (typeof req.query["code"] !== "string") {
    res.status(400).send("Invalid OAuth2 callback (no code).");
    return;
  }

  try {
    // openid-client validates `state` against the flow cookie and exchanges the code (+ PKCE).
    const currentUrl = new URL(`${baseUrl(req)}/api/auth/oauth2/callback${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`);
    const tokens = await completeOAuth2Login({ config: oauth2Config, currentUrl, expectedState: state, codeVerifier: verifier });
    const info = await fetchUserInfo(oauth2Config, tokens.accessToken);
    const user = mapUserInfo(oauth2Config, info);
    // Step-up: grant freshness only when this prompt=login re-auth is the same principal that began
    // the step-up flow (bound to `sub` inside the signed flow cookie).
    const grantStepUp = stepup === true && stepUpSub === user.sub;
    const travel = await travelCheck(user.sub, user.email, req.ip);
    setSession(res, {
      sub: user.sub,
      ...(user.name !== undefined ? { name: user.name } : {}),
      ...(user.email !== undefined ? { email: user.email } : {}),
      ...(user.roles && user.roles.length ? { roles: user.roles } : {}),
      // The provider's access token is opaque (not a backend bearer); identity only.
      accessToken: "oauth2",
      ...(grantStepUp ? { stepUpAt: Date.now() } : {}),
      ...travel,
    });
    setCsrfCookie(res, newCsrfToken()); // fresh CSRF token per login (rotation)
    res.redirect(safeLocalPath(returnTo));
  } catch (err) {
    req.log.error({ err }, "OAuth2 login failed");
    res.status(502).send("OAuth2 sign-in failed. Please try again.");
  }
});

// ── Magic-link / email-OTP (optional; only when no OIDC/SAML) ────────────────────
// Request a one-time sign-in link for an email. Always answers ok (never leaks whether the
// email exists); rate-limited at the router mount. In dev mode the link is returned for testing.
router.post("/auth/magic/request", async (req, res) => {
  if (!magicLinkEnabled()) { res.status(404).json({ error: "Magic-link sign-in is not enabled." }); return; }
  const email = typeof (req.body as { email?: unknown })?.email === "string" ? (req.body as { email: string }).email.trim() : "";
  if (!isValidEmail(email)) { res.status(400).json({ error: "Enter a valid email address." }); return; }
  const returnTo = safeLocalPath((req.body as { returnTo?: unknown })?.returnTo);
  const token = mintMagicToken(email, Date.now());
  const link = `${baseUrl(req)}/api/auth/magic/verify?token=${encodeURIComponent(token)}&returnTo=${encodeURIComponent(returnTo)}`;
  try { await sendMagicLink(email, link); } catch (err) { req.log.warn({ err }, "magic-link send failed"); }
  // Don't disclose account existence; in dev, hand back the link so it's testable without a relay.
  res.json({ ok: true, ...(isDevMode() ? { devLink: link } : {}) });
});

// Verify a magic token and establish the session (single-use). GET so it works from an email link.
router.get("/auth/magic/verify", async (req, res) => {
  if (!magicLinkEnabled()) { res.status(404).send("Magic-link sign-in is not enabled."); return; }
  const token = typeof req.query["token"] === "string" ? req.query["token"] : "";
  const verdict = verifyMagicToken(token, Date.now());
  if (!verdict) { res.status(400).send("This sign-in link is invalid or has expired."); return; }
  if (!(await consumeMagicToken(verdict.jti))) { res.status(400).send("This sign-in link has already been used."); return; }
  const travel = await travelCheck(verdict.email, verdict.email, req.ip);
  // A step-up link (minted by POST /auth/step-up for the signed-in user's own email) proves current
  // mailbox control — a genuine re-authentication for a passwordless method — so it stamps freshness.
  const grantStepUp = verdict.purpose === "stepup";
  setSession(res, { sub: verdict.email, name: verdict.email, email: verdict.email, accessToken: "magic", ...(grantStepUp ? { stepUpAt: Date.now() } : {}), ...travel });
  setCsrfCookie(res, newCsrfToken());
  res.redirect(safeLocalPath(req.query["returnTo"]));
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post("/auth/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE, cookieBase());
  res.clearCookie("omni_csrf", { ...cookieBase(), httpOnly: false, signed: false });
  res.json({ ok: true });
});

// ── Step-up re-authentication ───────────────────────────────────────────────────
// Stamp a fresh `stepUpAt` on the session so the highest-risk actions (key revocation,
// egress/governance changes, the raw escape hatch, secret writes) can demand a recent re-auth
// (see lib/step-up). CRITICAL: only DEMO mode (no real identity to phish) may confirm in place.
// Every REAL auth method must complete a genuine re-authentication ROUND-TRIP — otherwise a mere
// session holder could self-grant step-up by calling this endpoint, and the control would add no
// assurance beyond holding the cookie. Method is inferred from how the session was established.

type StepUpMethod = "oidc" | "saml" | "oauth2" | "magic";
/** Which auth method re-authenticates this session (from the identity marker set at login). */
function stepUpMethodFor(session: Session): StepUpMethod {
  switch (session.accessToken) {
    case "saml": return "saml";
    case "oauth2": return "oauth2";
    case "magic": return "magic";
    default: return "oidc";
  }
}

interface StepUpFlow { sub: string; returnTo: string }
function setStepUpFlow(res: Response, flow: StepUpFlow): void {
  res.cookie(STEPUP_COOKIE, JSON.stringify(flow), { ...cookieBase(), maxAge: FLOW_COOKIE_TTL_MS });
}
/** The step-up flow binding, when present + well-formed. */
function readStepUpFlow(req: Request): StepUpFlow | null {
  const raw = req.signedCookies?.[STEPUP_COOKIE];
  if (typeof raw !== "string") return null;
  try {
    const d = JSON.parse(raw) as StepUpFlow;
    return typeof d?.sub === "string" && typeof d?.returnTo === "string" ? d : null;
  } catch { return null; }
}

router.post("/auth/step-up", (req, res) => {
  const session = readSession(req);
  if (!session) { res.status(401).json({ error: "authentication required" }); return; }
  const returnTo = safeLocalPath((req.body as { returnTo?: unknown })?.returnTo);
  // Demo has no real identity — confirming in place is the only option and leaks nothing.
  if (isDemoAuth()) {
    setSession(res, { ...session, stepUpAt: Date.now() });
    res.json({ ok: true, stepUpAt: Date.now() });
    return;
  }
  // Magic-link can't be driven by a browser redirect, so re-challenge the session's own email with a
  // fresh single-use step-up link; verifying it (proving current mailbox control) stamps freshness.
  if (stepUpMethodFor(session) === "magic") {
    const email = session.email;
    if (!email) { res.status(409).json({ error: "no email on file for magic-link step-up" }); return; }
    const token = mintMagicToken(email, Date.now(), "stepup");
    const link = `${baseUrl(req)}/api/auth/magic/verify?token=${encodeURIComponent(token)}&returnTo=${encodeURIComponent(returnTo)}`;
    void sendMagicLink(email, link).catch((err) => req.log.warn({ err }, "magic step-up send failed"));
    res.status(202).json({ ok: false, code: "step_up_magic_sent", ...(isDevMode() ? { devLink: link } : {}) });
    return;
  }
  // OIDC / SAML / OAuth2: a real re-auth goes through the provider — tell the SPA where to send the user.
  res.status(409).json({ error: "re-authentication required", code: "step_up_redirect", url: `/api/auth/step-up?returnTo=${encodeURIComponent(returnTo)}` });
});

// Public, secret-free list of configured OIDC providers so the login screen can render a
// branded "Sign in with <label>" button per provider.
router.get("/auth/providers", (_req, res) => {
  res.json({ providers: oidcProviderList() });
});

// GET initiator: demo stamps + returns; every real method bounces through its provider for a genuine
// re-auth, and that method's callback stamps stepUpAt (OIDC prompt=login + auth_time; SAML ForceAuthn
// bound to the same sub via the step-up cookie; OAuth2 prompt=login bound to the same sub in its flow
// cookie). It NEVER self-stamps for a real method — that was the bypass this closes.
router.get("/auth/step-up", async (req, res) => {
  const returnTo = safeLocalPath(req.query["returnTo"]);
  const session = readSession(req);
  if (!session) { res.redirect(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`); return; }

  // Demo: no real identity — stamp in place (the only option; leaks nothing).
  if (isDemoAuth()) {
    setSession(res, { ...session, stepUpAt: Date.now() });
    res.redirect(returnTo);
    return;
  }

  const method = stepUpMethodFor(session);

  // SAML: ForceAuthn re-challenge; the ACS stamps step-up only when the SAME sub re-authenticates.
  if (method === "saml" && isSamlConfigured()) {
    setStepUpFlow(res, { sub: session.sub, returnTo });
    try {
      const url = await samlLoginUrl(returnTo, { forceAuthn: true });
      if (!url) { res.status(503).send("SAML step-up is unavailable (provider library not installed)."); return; }
      res.redirect(url);
    } catch (err) {
      req.log.error({ err }, "SAML step-up initiation failed");
      res.status(502).send("Re-authentication is temporarily unavailable.");
    }
    return;
  }

  // OAuth2: prompt=login re-challenge; the callback stamps step-up only when the SAME sub returns.
  if (method === "oauth2" && oauth2Config) {
    const { state, verifier } = newOAuth2Flow();
    res.cookie(OAUTH2_FLOW_COOKIE, JSON.stringify({ state, verifier, returnTo, stepup: true, sub: session.sub }), { ...cookieBase(), maxAge: FLOW_COOKIE_TTL_MS });
    const redirectUri = `${baseUrl(req)}/api/auth/oauth2/callback`;
    res.redirect(await buildAuthUrl({ config: oauth2Config, redirectUri, state, codeVerifier: verifier, reauth: true }));
    return;
  }

  // Magic-link is initiated from POST /api/auth/step-up (needs the email round-trip, not a redirect).
  if (method === "magic") {
    res.status(409).send("Re-authentication for magic-link sign-in is initiated from the app (POST /api/auth/step-up).");
    return;
  }

  const provider = getOidcProvider(typeof req.query["provider"] === "string" ? req.query["provider"] : null);
  if (!provider) {
    // Real auth is configured but no provider resolved — fail closed rather than self-stamp.
    res.status(409).send("Re-authentication is required but no provider is available for this session.");
    return;
  }
  try {
    const config = await discoverConfig(provider);
    const state = randomToken();
    const verifier = randomToken(48);
    const nonce = randomToken();
    const redirectUri = `${baseUrl(req)}/api/auth/callback`;
    res.cookie(FLOW_COOKIE, JSON.stringify({ state, verifier, nonce, returnTo, stepup: true, provider: provider.id }), { ...cookieBase(), maxAge: FLOW_COOKIE_TTL_MS });
    res.redirect(await buildOidcAuthUrl({ config, provider, redirectUri, state, nonce, verifier, prompt: "login" }));
  } catch (err) {
    req.log.error({ err }, "step-up initiation failed");
    res.status(502).send("Re-authentication is temporarily unavailable.");
  }
});

export default router;
