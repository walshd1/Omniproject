import crypto from "node:crypto";

/**
 * Minimal, dependency-free OpenID Connect (Authorization Code + PKCE) helper.
 *
 * The gateway acts as the OIDC relying party. When OIDC_ISSUER_URL /
 * OIDC_CLIENT_ID / OIDC_CLIENT_SECRET are configured, real SSO is enforced.
 * When they are not, the server runs in "demo" mode so the app remains usable
 * locally and in preview environments without an identity provider.
 */

export interface OidcConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
}

export interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
}

export interface SessionUser {
  sub: string;
  name?: string;
  email?: string;
}

export interface Session extends SessionUser {
  accessToken: string;
  idToken?: string;
}

const issuerUrl = process.env["OIDC_ISSUER_URL"]?.trim();
const clientId = process.env["OIDC_CLIENT_ID"]?.trim();
const clientSecret = process.env["OIDC_CLIENT_SECRET"]?.trim();

export const oidcConfig: OidcConfig | null =
  issuerUrl && clientId && clientSecret
    ? {
        issuerUrl: issuerUrl.replace(/\/+$/, ""),
        clientId,
        clientSecret,
        scope: process.env["OIDC_SCOPE"]?.trim() || "openid profile email",
      }
    : null;

export const isOidcConfigured = oidcConfig !== null;

// ── Discovery (cached) ────────────────────────────────────────────────────────

let discoveryCache: OidcDiscovery | null = null;

export async function discover(config: OidcConfig): Promise<OidcDiscovery> {
  if (discoveryCache) return discoveryCache;
  const url = `${config.issuerUrl}/.well-known/openid-configuration`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(`OIDC discovery failed (${res.status}) at ${url}`);
  }
  const doc = (await res.json()) as OidcDiscovery;
  if (!doc.authorization_endpoint || !doc.token_endpoint) {
    throw new Error("OIDC discovery document missing required endpoints");
  }
  discoveryCache = doc;
  return doc;
}

// ── PKCE / state helpers ──────────────────────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.randomBytes(bytes));
}

export function pkceChallenge(verifier: string): string {
  return base64url(crypto.createHash("sha256").update(verifier).digest());
}

// ── Token exchange ────────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
}

export async function exchangeCode(params: {
  config: OidcConfig;
  discovery: OidcDiscovery;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.config.clientId,
    client_secret: params.config.clientSecret,
    code_verifier: params.codeVerifier,
  });

  const res = await fetch(params.discovery.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Token exchange failed (${res.status}): ${detail.slice(0, 200)}`);
  }

  return (await res.json()) as TokenResponse;
}

/**
 * Decode (without signature verification) the JWT id_token to extract user
 * claims. The token was just received over TLS directly from the issuer's
 * token endpoint, so for session bootstrapping this is acceptable; downstream
 * authorization is still enforced by n8n / the backends using the bearer token.
 */
export function decodeIdTokenClaims(idToken: string): SessionUser | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return {
      sub: String(payload.sub ?? ""),
      name: payload.name ?? payload.preferred_username ?? undefined,
      email: payload.email ?? undefined,
    };
  } catch {
    return null;
  }
}
