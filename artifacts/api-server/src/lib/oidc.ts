import crypto from "node:crypto";
import * as client from "openid-client";
import { assertSafeOutboundUrl } from "./url-safety";
import { safeFetch } from "./egress";

/**
 * OpenID Connect (Authorization Code + PKCE) relying-party.
 *
 * The protocol state machine — discovery, PKCE, state/nonce, token exchange and ID-token
 * validation (iss/aud/exp/nonce/signature via the issuer JWKS) — is delegated to `openid-client`
 * (the maintained OIDC RP library, same author as `jose`), rather than hand-rolled. Every IdP HTTP
 * hop (discovery, JWKS, token, userinfo) is routed through `safeFetch` (see `oidcFetch`), so the
 * SSRF / DNS-rebind / residency guards on the IdP hops are preserved exactly as before. What stays
 * here is app-specific: the multi-provider env config, the claim→SessionUser mapping, and exposing
 * `auth_time` so the caller can enforce step-up freshness.
 *
 * When OIDC_ISSUER_URL / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET are configured, real SSO is enforced;
 * when they are not, the server runs in "demo" mode so the app stays usable without an IdP.
 */

/** Route EVERY openid-client HTTP request through safeFetch so the IdP hops keep the SSRF/residency
 *  guards. openid-client assigns this to the resolved Configuration, so token/JWKS/userinfo use it too.
 *  Signature matches openid-client's CustomFetch (url + fetch-like options). */
function oidcFetch(url: string, options: unknown): Promise<Response> {
  return safeFetch(url, options as RequestInit);
}

export interface OidcConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  /** Expected ID-token audience (defaults to clientId). */
  audience: string;
  /** Verify the ID token signature + claims against the issuer JWKS. */
  verifyToken: boolean;
  /** Requested `acr_values` (space-delimited), best-effort — asks the IdP for a specific
   *  authentication strength. Not all IdPs honour it; the gateway still separately VERIFIES
   *  the resulting amr/acr claim (see rbac.hasStrongAuth) rather than trusting the request. */
  acrValues?: string | undefined;
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
  name?: string | undefined;
  email?: string | undefined;
  /** Raw role/group claims from the IdP, used by the RBAC layer. */
  roles?: string[] | undefined;
  /** Authentication Methods References (RFC 8176) from the ID token, e.g. ["hwk"] for a
   *  WebAuthn/FIDO2 hardware-bound credential. Used to gate pmo/admin authority on
   *  tamper-resistant MFA (see rbac.hasStrongAuth) — never trusted for anything else. */
  amr?: string[] | undefined;
  /** Authentication Context Class Reference from the ID token — an alternative (IdP-specific)
   *  way of asserting authentication strength, checked alongside amr. */
  acr?: string | undefined;
}

/**
 * An EPHEMERAL dev-mode impersonation overlaid on a session. Honoured only in dev
 * mode and only until `expiresAt`; carries the real initiator (`by`) and the
 * required `reason` so every impersonated action is accountable.
 */
export interface Impersonation {
  sub: string;
  email?: string;
  roles?: string[];
  reason: string;
  by: string;
  expiresAt: number;
}

export interface Session extends SessionUser {
  accessToken: string;
  idToken?: string;
  impersonation?: Impersonation;
  /** Epoch ms the session was first issued (for the absolute-lifetime cap). */
  iat?: number;
  /** Epoch ms of the last activity (for the sliding idle timeout). */
  seen?: number;
  /** The session-key version this cookie was signed under (for key revocation). */
  kver?: number;
  /** Epoch ms of the last step-up (re-authentication) — gates the highest-risk actions. */
  stepUpAt?: number;
  /** Epoch ms this login was flagged as an implausible jump from the same principal's
   *  previous login location (lib/impossible-travel.ts). Invalidates any step-up minted
   *  before it — see lib/step-up.ts's stepUpFresh. */
  impossibleTravelAt?: number;
  /** Monotonic-clock reading (ns, as a string) at session creation — the
   *  non-rewindable "session start time" bound into the per-session broker key. */
  smono?: string;
  /** CSPRNG entropy minted once per session, so the per-session broker key is fresh
   *  on every login (and unique even across a process restart that resets `smono`). */
  salt?: string;
}

/** A configured OIDC provider: a relying-party config plus an id + display label so the
 *  login screen can render a branded "Sign in with <label>" button per provider. */
export interface OidcProvider extends OidcConfig {
  id: string;
  label: string;
}

// Verify by default; OIDC_SKIP_TOKEN_VERIFY=true is a global escape hatch only.
const verifyToken = process.env["OIDC_SKIP_TOKEN_VERIFY"]?.trim().toLowerCase() !== "true";

/** Read one provider's config from a set of env keys, or null if the required three are absent. */
function providerFromEnv(id: string, label: string, keyPrefix: string): OidcProvider | null {
  const issuer = process.env[`${keyPrefix}_ISSUER_URL`]?.trim();
  const clientId = process.env[`${keyPrefix}_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`${keyPrefix}_CLIENT_SECRET`]?.trim();
  if (!issuer || !clientId || !clientSecret) return null;
  return {
    id,
    label: process.env[`${keyPrefix}_LABEL`]?.trim() || label,
    issuerUrl: issuer.replace(/\/+$/, ""),
    clientId,
    clientSecret,
    scope: process.env[`${keyPrefix}_SCOPE`]?.trim() || "openid profile email",
    audience: process.env[`${keyPrefix}_AUDIENCE`]?.trim() || clientId,
    verifyToken,
    acrValues: process.env[`${keyPrefix}_ACR_VALUES`]?.trim() || undefined,
  };
}

/** An env-safe uppercase token for a provider id (so `google` → OIDC_GOOGLE_ISSUER_URL). */
function envToken(id: string): string {
  return id.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

/**
 * The configured OIDC providers. Two ways to configure, combined:
 *   - **Legacy single provider** — `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`
 *     (+ optional `OIDC_SCOPE` / `OIDC_AUDIENCE` / `OIDC_LABEL`). Becomes the provider `default`.
 *   - **Named providers** — `OIDC_PROVIDERS=google,microsoft` and, per id, `OIDC_<ID>_ISSUER_URL`
 *     etc. (e.g. `OIDC_GOOGLE_ISSUER_URL`). Each renders its own branded button.
 * The default (legacy) provider, if any, is listed first so it stays the implicit default.
 */
export const oidcProviders: OidcProvider[] = (() => {
  const out: OidcProvider[] = [];
  const legacy = providerFromEnv("default", process.env["OIDC_LABEL"]?.trim() || "SSO", "OIDC");
  if (legacy) out.push(legacy);
  const ids = (process.env["OIDC_PROVIDERS"]?.trim() || "")
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const id of ids) {
    if (id === "default" || out.some((p) => p.id === id)) continue; // legacy already covers "default"
    const p = providerFromEnv(id, id.charAt(0).toUpperCase() + id.slice(1), `OIDC_${envToken(id)}`);
    if (p) out.push(p);
  }
  return out;
})();

/** The default (first) provider, or null. Retained for callers that assume a single OIDC config. */
export const oidcConfig: OidcProvider | null = oidcProviders[0] ?? null;

export const isOidcConfigured = oidcProviders.length > 0;

/** Resolve a provider by id, falling back to the default (first) when id is absent/unknown. */
export function getOidcProvider(id?: string | null): OidcProvider | null {
  if (id) {
    const match = oidcProviders.find((p) => p.id === id);
    if (match) return match;
  }
  return oidcConfig;
}

/** The public, secret-free provider list for the login screen (id + label + kind). */
export function oidcProviderList(): { id: string; label: string; kind: "oidc" }[] {
  return oidcProviders.map((p) => ({ id: p.id, label: p.label, kind: "oidc" }));
}

// ── Configuration discovery (cached, via openid-client) ────────────────────────

// Cached per issuer, so multiple providers don't re-run discovery on every request.
const configCache = new Map<string, { cfg: client.Configuration; at: number }>();
const DISCOVERY_TTL_MS = 10 * 60 * 1000;

/** Discover (and cache, per issuer) the openid-client Configuration. openid-client fetches the
 *  issuer's `.well-known/openid-configuration`, validates the advertised `issuer` matches, and wires
 *  ClientSecretPost auth — all over `oidcFetch` (safeFetch), so the discovery hop stays SSRF-guarded. */
export async function discoverConfig(provider: OidcConfig): Promise<client.Configuration> {
  const cached = configCache.get(provider.issuerUrl);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.cfg;
  // Literal pre-check before any DNS (defence-in-depth; safeFetch re-checks after resolution).
  assertSafeOutboundUrl(`${provider.issuerUrl}/.well-known/openid-configuration`, "OIDC issuer");
  const cfg = await client.discovery(
    new URL(provider.issuerUrl),
    provider.clientId,
    provider.clientSecret,
    undefined,
    { [client.customFetch]: oidcFetch },
  );
  configCache.set(provider.issuerUrl, { cfg, at: Date.now() });
  return cfg;
}

/** Drop a cached Configuration (test seam / config change). */
export function __clearOidcConfigCache(): void {
  configCache.clear();
}

// ── PKCE / state helpers (kept for the generic OAuth2 flow; OIDC PKCE runs through openid-client) ──

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** A URL-safe random token (state/nonce/PKCE verifier), `bytes` of entropy. */
export function randomToken(bytes = 32): string {
  return base64url(crypto.randomBytes(bytes));
}

/** The S256 PKCE code_challenge for a verifier (base64url SHA-256). */
export function pkceChallenge(verifier: string): string {
  return base64url(crypto.createHash("sha256").update(verifier).digest());
}

/**
 * Build a provider's authorization-endpoint URL (Authorization Code + S256 PKCE + nonce) via
 * openid-client. Shared by the login and step-up flows. `prompt: "login"` forces a fresh credential
 * prompt (`prompt=login` + `max_age=0`) for step-up.
 */
export async function buildOidcAuthUrl(params: {
  config: client.Configuration;
  provider: OidcConfig;
  redirectUri: string;
  state: string;
  nonce: string;
  verifier: string;
  prompt?: "login";
}): Promise<string> {
  const p: Record<string, string> = {
    redirect_uri: params.redirectUri,
    scope: params.provider.scope,
    state: params.state,
    nonce: params.nonce,
    code_challenge: await client.calculatePKCECodeChallenge(params.verifier),
    code_challenge_method: "S256",
  };
  if (params.prompt === "login") {
    p["prompt"] = "login";
    p["max_age"] = "0";
  }
  if (params.provider.acrValues) p["acr_values"] = params.provider.acrValues;
  return client.buildAuthorizationUrl(params.config, p).href;
}

/** The validated result of an OIDC callback: the mapped session user plus the tokens the caller
 *  persists and the `auth_time` it needs for step-up freshness. */
export interface OidcLoginResult {
  user: SessionUser;
  accessToken: string;
  idToken: string | undefined;
  /** `auth_time` claim (seconds) — when the user actually authenticated at the IdP, for step-up. */
  authTime: number | null;
}

/**
 * Complete the Authorization-Code callback: openid-client exchanges the code (with the PKCE
 * verifier) at the token endpoint and validates the ID token end-to-end — signature against the
 * issuer JWKS, plus `iss`/`aud`/`exp` and the `state`/`nonce` bindings. Throws on any mismatch. All
 * HTTP (token + JWKS) runs through `oidcFetch` (safeFetch), so those hops stay SSRF-guarded.
 */
export async function completeOidcLogin(params: {
  config: client.Configuration;
  currentUrl: URL;
  expectedState: string;
  expectedNonce: string;
  verifier: string;
}): Promise<OidcLoginResult> {
  const tokens = await client.authorizationCodeGrant(params.config, params.currentUrl, {
    expectedState: params.expectedState,
    expectedNonce: params.expectedNonce,
    pkceCodeVerifier: params.verifier,
  });
  const claims = tokens.claims();
  if (!claims) throw new Error("OIDC token response contained no ID token");
  const authTime = typeof claims["auth_time"] === "number" && Number.isFinite(claims["auth_time"])
    ? (claims["auth_time"] as number)
    : null;
  return {
    user: claimsToSessionUser(claims as unknown as Record<string, unknown>),
    accessToken: tokens.access_token,
    idToken: tokens.id_token,
    authTime,
  };
}

/** Map validated ID-token claims onto the app's SessionUser (app-specific claim shapes). */
export function claimsToSessionUser(payload: Record<string, unknown>): SessionUser {
  return {
    sub: String(payload["sub"] ?? ""),
    name: (payload["name"] as string | undefined) ?? (payload["preferred_username"] as string | undefined) ?? undefined,
    email: (payload["email"] as string | undefined) ?? undefined,
    roles: extractRoles(payload),
    amr: extractAmr(payload),
    acr: typeof payload["acr"] === "string" ? (payload["acr"] as string) : undefined,
  };
}

/**
 * Collect role/group claims from the common places IdPs put them: a flat
 * `roles`/`groups` array, Keycloak's `realm_access.roles`, or a space-delimited
 * string. The RBAC layer maps these onto OmniProject roles via env config.
 */
/** The `amr` (Authentication Methods References, RFC 8176) claim — normally an array,
 *  but tolerate a single space-delimited string (some IdPs deviate). */
function extractAmr(payload: Record<string, unknown>): string[] | undefined {
  const raw = payload["amr"];
  if (Array.isArray(raw)) {
    const out = raw.filter((x): x is string => typeof x === "string");
    return out.length ? out : undefined;
  }
  if (typeof raw === "string" && raw.trim()) return raw.trim().split(/\s+/);
  return undefined;
}

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
