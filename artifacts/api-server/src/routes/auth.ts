import { Router, type Request, type Response } from "express";
import {
  oidcConfig,
  isOidcConfigured,
  discover,
  randomToken,
  pkceChallenge,
  exchangeCode,
  decodeIdTokenClaims,
  type Session,
} from "../lib/oidc";

const router = Router();

const SESSION_COOKIE = "omni_session";
const FLOW_COOKIE = "omni_oidc_flow";

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
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

function setSession(res: Response, session: Session): void {
  res.cookie(SESSION_COOKIE, JSON.stringify(session), {
    ...cookieBase,
    maxAge: 1000 * 60 * 60 * 8, // 8h
  });
}

// Exposed so other routes (e.g. the n8n proxy) can pull the bearer token.
export function getSession(req: Request): Session | null {
  return readSession(req);
}

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get("/auth/me", (req, res) => {
  const session = readSession(req);
  if (session) {
    res.json({
      authenticated: true,
      mode: isOidcConfigured ? "oidc" : "demo",
      user: { sub: session.sub, name: session.name, email: session.email },
    });
    return;
  }
  res.json({ authenticated: false, mode: isOidcConfigured ? "oidc" : "demo", user: null });
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

    const claims = tokens.id_token ? decodeIdTokenClaims(tokens.id_token) : null;

    setSession(res, {
      sub: claims?.sub || "unknown",
      name: claims?.name,
      email: claims?.email,
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
