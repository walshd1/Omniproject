import { randomToken, pkceChallenge, type SessionUser } from "./oidc";
import { assertSafeOutboundUrl } from "./url-safety";

/**
 * Generic OAuth 2.0 Authorization-Code (+ PKCE) login for **non-OIDC** providers — e.g. GitHub,
 * which issues opaque access tokens and exposes identity via a userinfo endpoint rather than a
 * signed ID token. OmniProject already speaks OIDC (lib/oidc); this is the sibling path for
 * providers that don't.
 *
 * The flow: authorize → exchange code for an access token → call the provider's userinfo endpoint
 * with that token → map the JSON fields onto a session user → mint the SAME signed+sealed session
 * cookie every other auth path uses (routes/auth.ts `setSession`). No tokens or profile data are
 * persisted; the gateway stays stateless.
 *
 * **Off by default.** Enabled only when the five OAUTH2_* endpoint/credential vars are all set.
 * Because there is no ID token to verify cryptographically, trust rests on (a) the
 * Authorization-Code grant over TLS, (b) the `state` + PKCE binding to this browser flow, and
 * (c) fetching identity from the provider's own userinfo endpoint with the freshly issued token.
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

/** Build the provider authorization URL the browser is redirected to (Authorization-Code + S256
 *  PKCE). The user's browser navigates here, so it is not a server-side fetch — but we still
 *  require a well-formed absolute http(s) URL. */
export function buildAuthUrl(params: {
  config: OAuth2Config;
  redirectUri: string;
  state: string;
  codeVerifier: string;
}): string {
  const url = new URL(params.config.authUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.config.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  if (params.config.scope) url.searchParams.set("scope", params.config.scope);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", pkceChallenge(params.codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

interface OAuth2TokenResponse {
  access_token: string;
  token_type?: string;
  scope?: string;
}

/** Exchange the authorization code (+ PKCE verifier) for an access token. SSRF-guarded; sends
 *  `Accept: application/json` so providers that default to form-encoded responses (GitHub) return
 *  JSON. Providers that don't implement PKCE simply ignore the `code_verifier`. */
export async function exchangeCodeOAuth2(params: {
  config: OAuth2Config;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
}): Promise<OAuth2TokenResponse> {
  assertSafeOutboundUrl(params.config.tokenUrl, "OAUTH2_TOKEN_URL");
  const fetchImpl = params.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.config.clientId,
    client_secret: params.config.clientSecret,
    code_verifier: params.codeVerifier,
  });
  const res = await fetchImpl(params.config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "OmniProject",
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OAuth2 token exchange failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as OAuth2TokenResponse & { error?: string };
  if (json.error || !json.access_token) {
    throw new Error(`OAuth2 token endpoint returned no access token${json.error ? ` (${json.error})` : ""}`);
  }
  return json;
}

/** Fetch the provider's userinfo with the bearer token. SSRF-guarded; sends a `User-Agent`
 *  (required by some providers, e.g. GitHub) and `Accept: application/json`. */
export async function fetchUserInfo(config: OAuth2Config, accessToken: string, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>> {
  assertSafeOutboundUrl(config.userInfoUrl, "OAUTH2_USERINFO_URL");
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

/** Map a provider's userinfo JSON onto a session user via the configured field mapping. The
 *  `sub` is required (we fall back across sub/id/login so GitHub works out of the box); roles are
 *  handed to the RBAC layer, which maps them onto OmniProject roles exactly as for OIDC. Throws
 *  when no usable identifier is present — matching the sibling OAuth2 functions in this file,
 *  which throw for their equivalent failures rather than returning a sentinel. */
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
