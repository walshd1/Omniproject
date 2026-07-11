import { logger } from "./logger";
import { loadOptionalDependency } from "./optional-dependency";
import { decodePemOrBase64 } from "./pem";
import { isTruthy } from "./env-config";
import { sharedKv, sharedStateMode } from "./shared-state";

/** How long a pending SP-initiated AuthnRequest id stays valid for InResponseTo matching. */
const SAML_REQUEST_TTL_MS = 8 * 60_000;

/**
 * A `@node-saml/node-saml` CacheProvider backed by the shared-state seam so SAML request-id /
 * replay state is enforced FLEET-WIDE (Redis when configured; per-replica otherwise — same
 * posture as rate-limit / session-registry). node-saml calls this to store each outgoing
 * AuthnRequest id and to validate + consume it on the ACS callback (`validateInResponseTo`),
 * which also blocks unsolicited/replayed responses.
 *
 * Interface (node-saml): `getAsync(key) → value | null`, `saveAsync(key, value) → {createdAt,
 * value} | null` (null when the key already exists — never overwrite), `removeAsync(key) → key`.
 *
 * NOTE: node-saml is a runtime-optional dependency not installed in this repo, so this adapter's
 * integration with the library is UNTESTED here (the adapter itself is unit-tested in isolation).
 * Verify the CacheProvider shape against the pinned node-saml version before relying on it.
 */
export function samlCacheProvider(kv = sharedKv, ttlMs = SAML_REQUEST_TTL_MS) {
  const k = (key: string): string => `saml:req:${key}`;
  return {
    async getAsync(key: string): Promise<string | null> {
      const raw = await kv.get(k(key));
      if (!raw) return null;
      try { return (JSON.parse(raw) as { value: string }).value; } catch { return null; }
    },
    async saveAsync(key: string, value: string): Promise<{ createdAt: number; value: string } | null> {
      if (await kv.get(k(key))) return null; // already present ⇒ node-saml expects null (no overwrite)
      const item = { createdAt: Date.now(), value };
      await kv.set(k(key), JSON.stringify(item), { ttlMs });
      return item;
    },
    async removeAsync(key: string): Promise<string | null> {
      await kv.del(k(key));
      return key;
    },
  };
}

/**
 * Replay-protection options for the node-saml provider — enabled ONLY when shared state is
 * Redis-backed. `validateInResponseTo` fails CLOSED (a missing/unknown request id ⇒ the login is
 * refused), so requiring it without a fleet-wide cache would break SP-initiated login on a
 * multi-replica, no-Redis deployment (the redirect and the ACS callback can land on different
 * replicas). In-memory mode therefore falls back to the always-on signature + `NotOnOrAfter` +
 * audience checks (a short, bounded replay window) and never breaks login — preserving the
 * stateless single-replica default. When Redis is present, the shared cache makes replay/
 * request-id state correct across replicas and the strict check is turned on.
 *
 * OPT-IN: a SINGLE-replica operator with no Redis can set `SAML_STRICT_REPLAY=1` to turn on
 * `validateInResponseTo` + assertion-id dedup using the in-memory `sharedKv` (redirect and ACS hit
 * the same process, so it's correct). Off by default — do NOT set it on a multi-replica-no-Redis
 * deployment, where a redirect and its ACS callback can land on different replicas and SP-initiated
 * login would then fail closed. Redis mode enables the strict check automatically (fleet-correct).
 */
export function replayProtection(): Record<string, unknown> {
  const strict = sharedStateMode() === "redis" || isTruthy(process.env["SAML_STRICT_REPLAY"]);
  if (!strict) return {};
  return {
    validateInResponseTo: "always",
    requestIdExpirationPeriodMs: SAML_REQUEST_TTL_MS,
    cacheProvider: samlCacheProvider(), // Redis-backed when REDIS_URL is set, else per-replica in-memory
  };
}

/**
 * SAML 2.0 SSO — an OPTIONAL identity path that sits alongside OIDC behind the same auth
 * seam. The gateway is the SAML Service Provider (SP); a corporate IdP (Okta, Azure AD,
 * ADFS, Authentik, …) asserts the user's identity + group attributes, which we map onto the
 * fixed OmniProject roles exactly like OIDC group claims (lib/rbac + the role-map editor).
 *
 * DEPENDENCY POSTURE (mirrors lib/rate-limit.ts' Redis store): the SAML library
 * `@node-saml/node-saml` is a RUNTIME-OPTIONAL dependency — it is NOT declared in
 * package.json, so a default `pnpm install` and the CI `--frozen-lockfile --ignore-scripts`
 * install never pull it, and OIDC/demo/charity deployments carry zero extra weight. It is
 * loaded via a dynamic `import()` (by a variable specifier, so it isn't statically resolved)
 * ONLY when `SAML_*` env is configured. If SAML is configured but the package isn't
 * installed, we log a one-time warning with the install command and SAML stays UNAVAILABLE —
 * OIDC/demo keep working and the gateway never crashes.
 *
 *   Enable with:  pnpm --filter @workspace/api-server add @node-saml/node-saml
 *
 * Config (env):
 *   SAML_IDP_ENTRY_POINT   the IdP's SSO redirect URL (required)
 *   SAML_IDP_CERT          the IdP's signing certificate — PEM, or base64-of-PEM (required)
 *   SAML_CALLBACK_URL      our ACS URL (defaults to `${PUBLIC_URL}/api/auth/saml/callback`)
 *   SAML_SP_ENTITY_ID      our SP entityID / issuer (defaults to PUBLIC_URL, else "omniproject")
 *   SAML_AUDIENCE          expected assertion audience (defaults to the SP entityID)
 *   SAML_EMAIL_ATTR / SAML_NAME_ATTR / SAML_GROUPS_ATTR  attribute names to read (defaults
 *                          "email" / "displayName" / "groups"; set to your IdP's URNs)
 *   SAML_WANT_RESPONSE_SIGNED=true  also require the <Response> signed (assertions are always
 *                          required signed regardless).
 *
 * HONEST SCOPE: SAML authenticates the user to the GATEWAY and drives RBAC; it does not mint
 * a per-user backend bearer token, so brokered writes use the broker's own credentials rather
 * than the user's (same as demo). Use OIDC where per-user backend tokens are needed.
 */

export interface SamlConfig {
  entryPoint: string;
  idpCert: string;
  issuer: string;
  callbackUrl: string;
  audience: string;
  emailAttr: string;
  nameAttr: string;
  groupsAttr: string;
  /** Attribute name carrying an authentication-strength assertion (e.g. an
   *  AuthnContextClassRef the IdP maps into a plain attribute), for the same
   *  tamper-resistant-MFA gate OIDC's amr/acr feeds (rbac.hasStrongAuth). No
   *  universal default — unlike email/name/groups there's no cross-IdP convention,
   *  so this is unset unless SAML_ACR_ATTR is configured. */
  acrAttr?: string | undefined;
  wantResponseSigned: boolean;
}

/** Accept an IdP cert as PEM, or as base64-of-PEM (env-friendly, no embedded newlines). */
function readCert(raw?: string): string | null {
  // A bare base64 cert body (no PEM markers at all) is also accepted — node-saml handles it.
  return decodePemOrBase64(raw, "BEGIN CERTIFICATE", true);
}

function readConfig(): SamlConfig | null {
  const entryPoint = process.env["SAML_IDP_ENTRY_POINT"]?.trim() || process.env["SAML_ENTRY_POINT"]?.trim();
  const idpCert = readCert(process.env["SAML_IDP_CERT"]);
  const publicUrl = process.env["PUBLIC_URL"]?.trim().replace(/\/+$/, "");
  const callbackUrl =
    process.env["SAML_CALLBACK_URL"]?.trim() || (publicUrl ? `${publicUrl}/api/auth/saml/callback` : "");
  if (!entryPoint || !idpCert || !callbackUrl) return null;
  const issuer = process.env["SAML_SP_ENTITY_ID"]?.trim() || publicUrl || "omniproject";
  return {
    entryPoint,
    idpCert,
    issuer,
    callbackUrl,
    audience: process.env["SAML_AUDIENCE"]?.trim() || issuer,
    emailAttr: process.env["SAML_EMAIL_ATTR"]?.trim() || "email",
    nameAttr: process.env["SAML_NAME_ATTR"]?.trim() || "displayName",
    groupsAttr: process.env["SAML_GROUPS_ATTR"]?.trim() || "groups",
    acrAttr: process.env["SAML_ACR_ATTR"]?.trim() || undefined,
    wantResponseSigned: isTruthy(process.env["SAML_WANT_RESPONSE_SIGNED"]),
  };
}

const samlConfig: SamlConfig | null = readConfig();

/** Is SAML SSO configured? (entry point + IdP cert + an ACS callback URL are all present.) */
export function isSamlConfigured(): boolean {
  return samlConfig !== null;
}

/**
 * A first-class, actionable view of the SAML configuration — what's present, what's still
 * missing, and whether it is PARTIALLY configured (a footgun: some `SAML_*` env is set but
 * SAML stays disabled). Pure over the passed env so it is unit-testable and reusable by the
 * boot-time env check. The three fields below are the ONLY hard requirements; every other
 * `SAML_*` var has a sensible default.
 */
export interface SamlConfigStatus {
  /** All hard requirements present ⇒ SAML SSO is active. */
  configured: boolean;
  /** Some `SAML_*` env is set but a requirement is missing ⇒ SAML is (silently) off. */
  partial: boolean;
  /** Which of the three hard requirements are satisfied. */
  present: { entryPoint: boolean; idpCert: boolean; callbackUrl: boolean };
  /** Human-friendly names of the env still needed to enable SAML (empty when configured). */
  missing: string[];
}

/** Compute the SAML config status from an arbitrary env (pure — the testable core). */
export function samlConfigStatusFrom(env: NodeJS.ProcessEnv): SamlConfigStatus {
  const entryPoint = !!(env["SAML_IDP_ENTRY_POINT"]?.trim() || env["SAML_ENTRY_POINT"]?.trim());
  const idpCert = !!env["SAML_IDP_CERT"]?.trim();
  // The ACS URL is explicit (SAML_CALLBACK_URL) or derived from PUBLIC_URL — either satisfies it.
  const callbackUrl = !!(env["SAML_CALLBACK_URL"]?.trim() || env["PUBLIC_URL"]?.trim());
  const present = { entryPoint, idpCert, callbackUrl };
  const missing: string[] = [];
  if (!entryPoint) missing.push("SAML_IDP_ENTRY_POINT");
  if (!idpCert) missing.push("SAML_IDP_CERT");
  if (!callbackUrl) missing.push("SAML_CALLBACK_URL (or PUBLIC_URL)");
  const configured = entryPoint && idpCert && callbackUrl;
  // "partial" must key off a SAML-SPECIFIC signal (some `SAML_*` env), NOT the shared PUBLIC_URL
  // — every deployment sets PUBLIC_URL for unrelated reasons, so it can't imply intent to run SAML.
  const samlIntent = Object.keys(env).some((k) => k.startsWith("SAML_") && env[k]?.trim());
  return { configured, partial: samlIntent && !configured, present, missing };
}

/** The SAML config status for the running process (diagnostics + the /auth/me surface). */
export function samlConfigStatus(): SamlConfigStatus {
  return samlConfigStatusFrom(process.env);
}

// Boot-time footgun guard: if SAML is only HALF configured it will silently stay disabled and
// operators get a confusing 404 at /auth/saml/login. Say so loudly, once, at load — with the
// exact missing env — so a CISO/IT rollout self-diagnoses. (Fully unset = intentional; no noise.)
{
  const status = samlConfigStatusFrom(process.env);
  if (status.partial) {
    logger.warn(
      { missing: status.missing },
      `SAML SSO is PARTIALLY configured and will stay DISABLED until all requirements are set — missing: ${status.missing.join(", ")}`,
    );
  }
}

export interface SamlClaims {
  sub: string;
  name?: string;
  email?: string;
  roles: string[];
  /** Authentication-strength assertion, if `SAML_ACR_ATTR` is configured (see SamlConfig.acrAttr). */
  acr?: string;
}

/** Coerce a SAML attribute value (string | string[] | object) to its first string. */
function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const s = value.find((v) => typeof v === "string");
    return typeof s === "string" ? s : undefined;
  }
  return undefined;
}

/** Coerce a SAML attribute value to a string[] (a single value, an array, or a comma/space
 *  list all normalise to the list of group/role claim names). */
function toStringArray(value: unknown): string[] {
  if (typeof value === "string") return value.split(/[\s,]+/).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(toStringArray);
  return [];
}

export interface SamlProfileLike {
  nameID?: unknown;
  attributes?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Map a validated SAML assertion profile onto canonical claims. The `roles` are the IdP
 * group/attribute values; they flow into the SAME role-map (lib/rbac) as OIDC group claims,
 * so a group → OmniProject-role assignment works identically across both protocols. Pure +
 * exported so it can be unit-tested without the SAML library present.
 */
export function profileToClaims(profile: SamlProfileLike, cfg: SamlConfig): SamlClaims {
  const attr = (name: string): unknown => {
    if (profile.attributes && name in profile.attributes) return profile.attributes[name];
    return profile[name];
  };
  const email = firstString(attr(cfg.emailAttr)) ?? firstString(profile["email"]);
  const name = firstString(attr(cfg.nameAttr)) ?? firstString(profile["displayName"]);
  const sub = firstString(profile.nameID) ?? email ?? "unknown";
  const roles = toStringArray(attr(cfg.groupsAttr));
  const acr = cfg.acrAttr ? firstString(attr(cfg.acrAttr)) : undefined;
  return { sub, roles, ...(name ? { name } : {}), ...(email ? { email } : {}), ...(acr ? { acr } : {}) };
}

// ── Runtime-optional SAML provider (dynamic import; cached) ───────────────────────

/** The minimal surface of `@node-saml/node-saml`'s SAML class that we use. */
interface SamlProvider {
  getAuthorizeUrlAsync(relayState: string, host: string | undefined, options: Record<string, unknown>): Promise<string>;
  validatePostResponseAsync(container: Record<string, string>): Promise<{ profile: SamlProfileLike | null; loggedOut: boolean }>;
  generateServiceProviderMetadata?(decryptionCert: string | null, signingCert: string | null): string | Promise<string>;
}

let providerPromise: Promise<SamlProvider | null> | null = null;

async function getProvider(): Promise<SamlProvider | null> {
  if (!samlConfig) return null;
  providerPromise ??= (async () => {
    const Ctor = await loadOptionalDependency<new (opts: Record<string, unknown>) => SamlProvider>(
      "@node-saml/node-saml",
      (mod) => {
        const SamlClass = (mod as { SAML?: unknown } | null)?.SAML;
        return typeof SamlClass === "function" ? (SamlClass as new (opts: Record<string, unknown>) => SamlProvider) : undefined;
      },
      "SAML is configured but '@node-saml/node-saml' is not installed — SAML SSO is UNAVAILABLE (OIDC/demo unaffected). Run: pnpm --filter @workspace/api-server add @node-saml/node-saml",
    );
    if (!Ctor) return null;
    return new Ctor({
      callbackUrl: samlConfig.callbackUrl,
      entryPoint: samlConfig.entryPoint,
      issuer: samlConfig.issuer,
      idpCert: samlConfig.idpCert,
      audience: samlConfig.audience,
      // The assertion (which carries identity) MUST be signed; response signing is optional
      // since many IdPs sign only the assertion. Operators can demand both via env.
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: samlConfig.wantResponseSigned,
      disableRequestedAuthnContext: true,
      signatureAlgorithm: "sha256",
      digestAlgorithm: "sha256",
      // Replay protection (Redis-gated — see replayProtection): blocks unsolicited/replayed
      // SAMLResponses via validateInResponseTo, but only when shared state is fleet-wide, so the
      // stateless single-replica default and multi-replica-without-Redis never break SP login.
      ...replayProtection(),
    });
  })();
  return providerPromise;
}

/** The IdP redirect URL to begin SP-initiated login; `relayState` round-trips the returnTo.
 *  Null when SAML is unconfigured or the optional library isn't installed. */
export async function samlLoginUrl(relayState: string): Promise<string | null> {
  const provider = await getProvider();
  if (!provider) return null;
  return provider.getAuthorizeUrlAsync(relayState, undefined, {});
}

/** Validate a base64 SAMLResponse from the ACS POST and return canonical claims, or null
 *  (unconfigured / library absent). Throws if the assertion is invalid (bad signature,
 *  audience, conditions) — the caller maps that to a 401. */
export async function validateSamlResponse(samlResponse: string): Promise<SamlClaims | null> {
  const provider = await getProvider();
  if (!provider || !samlConfig) return null;
  const { profile } = await provider.validatePostResponseAsync({ SAMLResponse: samlResponse });
  if (!profile) return null;
  return profileToClaims(profile, samlConfig);
}

/** The SP metadata XML (so an IdP admin can configure the integration), or null. */
export async function samlMetadata(): Promise<string | null> {
  const provider = await getProvider();
  if (!provider?.generateServiceProviderMetadata) return null;
  return provider.generateServiceProviderMetadata(null, null);
}
