import { logger } from "./logger";

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
  wantResponseSigned: boolean;
}

/** Accept an IdP cert as PEM, or as base64-of-PEM (env-friendly, no embedded newlines). */
function readCert(raw?: string): string | null {
  const v = raw?.trim();
  if (!v) return null;
  if (v.includes("BEGIN CERTIFICATE")) return v;
  try {
    const decoded = Buffer.from(v, "base64").toString("utf8");
    if (decoded.includes("BEGIN CERTIFICATE")) return decoded;
  } catch {
    /* not base64 */
  }
  return v; // assume a bare base64 cert body, which node-saml also accepts
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
    wantResponseSigned: process.env["SAML_WANT_RESPONSE_SIGNED"]?.trim().toLowerCase() === "true",
  };
}

const samlConfig: SamlConfig | null = readConfig();

/** Is SAML SSO configured? (entry point + IdP cert + an ACS callback URL are all present.) */
export function isSamlConfigured(): boolean {
  return samlConfig !== null;
}

export interface SamlClaims {
  sub: string;
  name?: string;
  email?: string;
  roles: string[];
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
  return { sub, roles, ...(name ? { name } : {}), ...(email ? { email } : {}) };
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
    // Variable specifier so the bundler/tsc don't statically resolve the optional dep.
    const pkgName = "@node-saml/node-saml";
    const mod = await import(pkgName).catch(() => null);
    const SamlClass = (mod as { SAML?: unknown } | null)?.SAML;
    if (typeof SamlClass !== "function") {
      logger.warn(
        "SAML is configured but '@node-saml/node-saml' is not installed — SAML SSO is UNAVAILABLE (OIDC/demo unaffected). Run: pnpm --filter @workspace/api-server add @node-saml/node-saml",
      );
      return null;
    }
    const Ctor = SamlClass as new (opts: Record<string, unknown>) => SamlProvider;
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
