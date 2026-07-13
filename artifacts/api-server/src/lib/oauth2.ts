import * as client from "openid-client";
import { randomToken, type SessionUser } from "./oidc";
import { assertEgressAllowed, safeFetch } from "./egress";

/**
 * Generic OAuth 2.0 Authorization-Code (+ PKCE) login for **non-OIDC** providers — e.g. GitHub,
 * which issues opaque access tokens and exposes identity via a userinfo endpoint rather than a
 * signed ID token. OmniProject already speaks OIDC (lib/oidc); this is the sibling path for
 * providers that don't.
 *
 * The Authorization-Code protocol (authorize URL, PKCE, `state`, code→token exchange) runs through
 * `openid-client` — the same vetted library the OIDC path uses — over a non-OIDC Configuration built
 * from the explicit endpoints (these providers have no discovery document). Every hop goes through
 * `safeFetch` (SSRF/residency guarded). The USERINFO step stays app-specific: openid-client's
 * `fetchUserInfo` assumes an OIDC `sub`, which non-OIDC providers (GitHub's `id`/`login`) don't have,
 * so identity is fetched + mapped here.
 *
 * **Off by default.** Enabled only when the five OAUTH2_* endpoint/credential vars are all set.
 */

export interface OAuth2Config {
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  /** Which userinfo JSON fields carry the identity. Defaults suit OIDC-style userinfo; the
   *  GitHub preset documents the overrides (`id`/`login`). */
  fields: { sub: string; name: string; email: string; roles: string };
}

const authUrl = process.env["OAUTH2_AUTH_URL"]?.trim();
const tokenUrl = process.env["OAUTH2_TOKEN_URL"]?.trim();
const userInfoUrl = process.env["OAUTH2_USERINFO_URL"]?.trim();
const clientId = process.env["OAUTH2_CLIENT_ID"]?.trim();
const clientSecret = process.env["OAUTH2_CLIENT_SECRET"]?.trim();

export const oauth2Config: OAuth2Config | null =
  authUrl && tokenUrl && userInfoUrl && clientId && clientSecret
    ? {
        authUrl,
        tokenUrl,
        userInfoUrl,
        clientId,
        clientSecret,
        scope: process.env["OAUTH2_SCOPE"]?.trim() || "read:user user:email",
        fields: {
          sub: process.env["OAUTH2_USERINFO_SUB_FIELD"]?.trim() || "sub",
          name: process.env["OAUTH2_USERINFO_NAME_FIELD"]?.trim() || "name",
          email: process.env["OAUTH2_USERINFO_EMAIL_FIELD"]?.trim() || "email",
          roles: process.env["OAUTH2_USERINFO_ROLES_FIELD"]?.trim() || "roles",
        },
      }
    : null;

export const isOAuth2Configured = oauth2Config !== null;

/** Route every openid-client HTTP hop through safeFetch (SSRF/residency guarded). */
function oauth2Fetch(url: string, options: unknown): Promise<Response> {
  return safeFetch(url, options as RequestInit);
}

/** Build a non-OIDC openid-client Configuration from the explicit endpoints (these providers have no
 *  discovery). The `issuer` is synthesised from the authorize URL's origin — it isn't used to validate
 *  any token (there's no ID token), only to satisfy the Configuration's server-metadata shape. Cached. */
let cachedConfig: client.Configuration | null = null;
function oauth2ClientConfig(cfg: OAuth2Config): client.Configuration {
  if (cachedConfig) return cachedConfig;
  const server: client.ServerMetadata = {
    issuer: new URL(cfg.authUrl).origin,
    authorization_endpoint: cfg.authUrl,
    token_endpoint: cfg.tokenUrl,
  };
  const config = new client.Configuration(server, cfg.clientId, cfg.clientSecret);
  config[client.customFetch] = oauth2Fetch;
  cachedConfig = config;
  return config;
}

/** Test seam / config-change: drop the cached Configuration. */
export function __clearOAuth2ConfigCache(): void {
  cachedConfig = null;
}

/** Build the provider authorization URL the browser is redirected to (Authorization-Code + S256 PKCE),
 *  via openid-client. `reauth` forces a fresh prompt for step-up (best-effort per provider). */
export async function buildAuthUrl(params: {
  config: OAuth2Config;
  redirectUri: string;
  state: string;
  codeVerifier: string;
  reauth?: boolean;
}): Promise<string> {
  const config = oauth2ClientConfig(params.config);
  const p: Record<string, string> = {
    redirect_uri: params.redirectUri,
    scope: params.config.scope,
    state: params.state,
    code_challenge: await client.calculatePKCECodeChallenge(params.codeVerifier),
    code_challenge_method: "S256",
  };
  if (params.reauth) { p["prompt"] = "login"; p["max_age"] = "0"; }
  return client.buildAuthorizationUrl(config, p).href;
}

/** Complete the callback: openid-client validates `state` and exchanges the code (+ PKCE verifier) for
 *  the access token. No ID token is expected (non-OIDC). Returns the opaque access token. */
export async function completeOAuth2Login(params: {
  config: OAuth2Config;
  currentUrl: URL;
  expectedState: string;
  codeVerifier: string;
}): Promise<{ accessToken: string }> {
  const config = oauth2ClientConfig(params.config);
  const tokens = await client.authorizationCodeGrant(config, params.currentUrl, {
    expectedState: params.expectedState,
    pkceCodeVerifier: params.codeVerifier,
  });
  if (!tokens.access_token) throw new Error("OAuth2 token endpoint returned no access token");
  return { accessToken: tokens.access_token };
}

/** Fetch the provider's userinfo with the bearer token. SSRF-guarded; sends a `User-Agent`
 *  (required by some providers, e.g. GitHub) and `Accept: application/json`. Non-OIDC, so this is
 *  NOT openid-client's fetchUserInfo (which assumes an OIDC `sub`). */
export async function fetchUserInfo(config: OAuth2Config, accessToken: string, fetchImpl: typeof fetch = safeFetch as unknown as typeof fetch): Promise<Record<string, unknown>> {
  await assertEgressAllowed(config.userInfoUrl); // literal + post-DNS recheck + allowlist/residency
  const res = await fetchImpl(config.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "OmniProject",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`OAuth2 userinfo fetch failed (${res.status})`);
  return (await res.json()) as Record<string, unknown>;
}

/** Collect roles from a userinfo field that may be a string, a delimited string, or an array. */
function collectRoles(value: unknown): string[] {
  const out = new Set<string>();
  if (typeof value === "string") value.split(/[\s,]+/).filter(Boolean).forEach((s) => out.add(s));
  else if (Array.isArray(value)) value.forEach((x) => typeof x === "string" && out.add(x));
  return [...out];
}

/** Read the first present string field from the userinfo, trying the configured name then
 *  common fallbacks (so GitHub's `id`/`login` resolve even with default mapping). */
function pickString(info: Record<string, unknown>, primary: string, fallbacks: string[]): string | undefined {
  for (const key of [primary, ...fallbacks]) {
    const v = info[key];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

/** Map a provider's userinfo JSON onto a session user via the configured field mapping. */
export function mapUserInfo(config: OAuth2Config, info: Record<string, unknown>): SessionUser {
  const sub = pickString(info, config.fields.sub, ["sub", "id", "login"]);
  if (!sub) throw new Error("OAuth2 userinfo response has no subject identifier");
  return {
    sub,
    name: pickString(info, config.fields.name, ["name", "login"]),
    email: pickString(info, config.fields.email, ["email"]),
    roles: collectRoles(info[config.fields.roles]),
  };
}

/** A fresh `state` + PKCE verifier for a login flow. */
export function newOAuth2Flow(): { state: string; verifier: string } {
  return { state: randomToken(), verifier: randomToken(48) };
}
