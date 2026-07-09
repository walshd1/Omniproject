import crypto from "node:crypto";
import { verifyIdToken as jwksVerify } from "./jwks";
import { assertSafeOutboundUrl } from "./url-safety";
import { safeFetch } from "./egress";

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

// ── Discovery (cached) ────────────────────────────────────────────────────────

// Cached per issuer, so multiple providers don't clobber one another's discovery docs.
const discoveryCache = new Map<string, { doc: OidcDiscovery; at: number }>();
const DISCOVERY_TTL_MS = 10 * 60 * 1000;

/** Fetch (and cache, per issuer) the issuer's OIDC discovery document. */
export async function discover(config: OidcConfig): Promise<OidcDiscovery> {
  const cached = discoveryCache.get(config.issuerUrl);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.doc;
  const url = `${config.issuerUrl}/.well-known/openid-configuration`;
  assertSafeOutboundUrl(url, "OIDC issuer");
  // safeFetch re-checks after DNS resolution (blocks an issuer host that resolves to a metadata/
  // link-local/private IP) and enforces the residency egress gate on the IdP hop.
  const res = await safeFetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(`OIDC discovery failed (${res.status}) at ${url}`);
  }
  const doc = (await res.json()) as OidcDiscovery;
  if (!doc.authorization_endpoint || !doc.token_endpoint) {
    throw new Error("OIDC discovery document missing required endpoints");
  }
  discoveryCache.set(config.issuerUrl, { doc, at: Date.now() });
  return doc;
}

// ── PKCE / state helpers ──────────────────────────────────────────────────────

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

/** Build a provider's authorization-endpoint URL (Authorization Code + S256 PKCE + nonce).
 *  Shared by the login and step-up flows so the query is constructed in exactly one place. */
export function authorizeUrl(params: {
  provider: OidcConfig;
  discovery: OidcDiscovery;
  redirectUri: string;
  state: string;
  nonce: string;
  verifier: string;
  prompt?: "login";
}): string {
  const url = new URL(params.discovery.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.provider.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", params.provider.scope);
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", pkceChallenge(params.verifier));
  url.searchParams.set("code_challenge_method", "S256");
  if (params.prompt === "login") {
    url.searchParams.set("prompt", "login"); // force a fresh credential prompt (step-up)
    url.searchParams.set("max_age", "0");
  }
  if (params.provider.acrValues) url.searchParams.set("acr_values", params.provider.acrValues);
  return url.toString();
}

// ── Token exchange ────────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
}

/** Exchange an authorization code (with the PKCE verifier) for the token set at
 *  the IdP's token endpoint. */
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

  // token_endpoint comes from the issuer's discovery doc (IdP-controlled) — guard it too, and
  // resolve-then-check + residency-gate via safeFetch so the client_secret can't be POSTed to a
  // host that resolves to cloud metadata.
  assertSafeOutboundUrl(params.discovery.token_endpoint, "token_endpoint");
  const res = await safeFetch(params.discovery.token_endpoint, {
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

/** Decode a JWT's payload segment (base64url JSON) without checking its signature — the
 *  signature MUST already have been verified by the caller (see verifyIdToken); this only
 *  reads bytes already proven authentic. Malformed structure (wrong segment count, bad
 *  base64/JSON) ⇒ null. */
function decodeJwtPayload(idToken: string): Record<string, unknown> | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Thrown by decodeIdTokenClaims when the (already signature-verified) ID token's payload
 *  can't be decoded — this only runs AFTER verification has succeeded, so a decode failure
 *  here means the "verified" bytes aren't well-formed JWT claims: a real bug or tampering,
 *  not a normal "claims absent" case. */
export class InvalidIdTokenClaimsError extends Error {
  constructor() {
    super("ID token claims could not be decoded after signature verification succeeded — this indicates tampering or a non-compliant IdP");
    this.name = "InvalidIdTokenClaimsError";
  }
}

/**
 * Decode the JWT id_token to extract user claims. The signature MUST have been
 * verified first (see verifyIdToken); this only reads the payload. Throws
 * InvalidIdTokenClaimsError if the (already-verified) token can't be decoded.
 */
export function decodeIdTokenClaims(idToken: string): SessionUser {
  const payload = decodeJwtPayload(idToken);
  if (!payload) throw new InvalidIdTokenClaimsError();
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
 * Read the `nonce` claim from an ID token's payload (or null if absent/malformed).
 * Used to assert the token was minted for THIS login flow. The signature MUST have
 * been verified first (see verifyIdToken); this only reads the payload.
 */
export function idTokenNonce(idToken: string): string | null {
  const payload = decodeJwtPayload(idToken);
  if (!payload) return null;
  return typeof payload["nonce"] === "string" ? (payload["nonce"] as string) : null;
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
