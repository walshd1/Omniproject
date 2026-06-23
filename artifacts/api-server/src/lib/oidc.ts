import crypto from "node:crypto";
import { verifyIdToken as jwksVerify } from "./jwks";

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
  /** Expected ID-token audience (defaults to clientId). */
  audience: string;
  /** Verify the ID token signature + claims against the issuer JWKS. */
  verifyToken: boolean;
}

export interface OidcDiscovery {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri?: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
}

export interface SessionUser {
  sub: string;
  name?: string;
  email?: string;
  /** Raw role/group claims from the IdP, used by the RBAC layer. */
  roles?: string[];
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
        audience: process.env["OIDC_AUDIENCE"]?.trim() || clientId,
        // Verify by default; OIDC_SKIP_TOKEN_VERIFY=true is an escape hatch only.
        verifyToken: process.env["OIDC_SKIP_TOKEN_VERIFY"]?.trim().toLowerCase() !== "true",
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
 * Cryptographically verify the ID token against the issuer's JWKS and validate
 * iss/aud/exp/nbf. Throws on any failure. Skipped only when verifyToken is off
 * or the discovery document exposes no jwks_uri (logged by the caller).
 */
export async function verifyIdToken(
  idToken: string,
  config: OidcConfig,
  discovery: OidcDiscovery,
): Promise<void> {
  if (!config.verifyToken) return;
  if (!discovery.jwks_uri) {
    throw new Error("OIDC discovery exposes no jwks_uri — cannot verify ID token (set OIDC_SKIP_TOKEN_VERIFY=true to override)");
  }
  await jwksVerify(idToken, {
    jwksUri: discovery.jwks_uri,
    issuer: discovery.issuer || config.issuerUrl,
    audience: config.audience,
  });
}

/**
 * Decode the JWT id_token to extract user claims. The signature MUST have been
 * verified first (see verifyIdToken); this only reads the payload.
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
      roles: extractRoles(payload),
    };
  } catch {
    return null;
  }
}

/**
 * Collect role/group claims from the common places IdPs put them: a flat
 * `roles`/`groups` array, Keycloak's `realm_access.roles`, or a space-delimited
 * string. The RBAC layer maps these onto OmniProject roles via env config.
 */
function extractRoles(payload: Record<string, unknown>): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string") v.split(/[\s,]+/).filter(Boolean).forEach((s) => out.add(s));
    else if (Array.isArray(v)) v.forEach((x) => typeof x === "string" && out.add(x));
  };
  add(payload["roles"]);
  add(payload["groups"]);
  const realm = payload["realm_access"];
  if (realm && typeof realm === "object") add((realm as Record<string, unknown>)["roles"]);
  return [...out];
}
