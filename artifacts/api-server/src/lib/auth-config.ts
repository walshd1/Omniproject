import { isTruthy } from "./env-config";

/**
 * Is the gateway running in DEMO auth mode — i.e. NO real authentication method is configured at all?
 *
 * Demo mode grants every session full access so the product is usable out of the box (there's no real
 * identity to phish). It MUST therefore be inferred from the absence of *every* real login method, not
 * from a single legacy env var. The previous check (`!OIDC_ISSUER_URL`) mis-fired for every modern
 * deployment that leaves that legacy var unset — named OIDC providers, SAML, OAuth2, and magic-link —
 * silently elevating every authenticated user to full admin.
 *
 * SINGLE SOURCE OF TRUTH: the detection is expressed once, as a pure function over an env map
 * (`isDemoAuthFrom`), so the runtime gate (`isDemoAuth`) and the boot-time security self-check
 * (lib/security-check.ts) can never disagree about what "demo mode" means. Previously the boot check
 * re-derived demo-ness from `OIDC_ISSUER_URL` alone, so a correctly-configured SAML/OAuth2/named-OIDC
 * deployment was BOTH (a) correctly treated as real-auth at runtime AND (b) falsely flagged as demo
 * auth at boot — refusing to boot on an enterprise profile. Keeping the two in one place closes that
 * drift permanently: any auth method added here is covered by both the gate and the blocker.
 *
 * The sub-checks are intentionally self-contained (they read env directly rather than importing the
 * oidc/oauth2/saml/magic-link modules) so this stays a cheap, dependency-free pure function the boot
 * self-check can call without pulling those modules' load-time side effects into its unit tests.
 */

type Env = Record<string, string | undefined>;

const isSet = (v: string | undefined): boolean => !!v?.trim();

/** An env-safe uppercase token for a provider id (mirrors lib/oidc.ts `envToken`): `google` → GOOGLE. */
function providerToken(id: string): string {
  return id.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

/** True when at least one NAMED OIDC provider (`OIDC_PROVIDERS=…`) has its required trio set — the
 *  same completeness test lib/oidc.ts `providerFromEnv` applies (issuer + client id + secret). The
 *  LEGACY single provider (`OIDC_ISSUER_URL`) is handled by the caller's short-circuit. */
function namedOidcConfigured(env: Env): boolean {
  const ids = (env["OIDC_PROVIDERS"]?.trim() || "")
    .split(/[\s,]+/)
    .map((s) => providerToken(s))
    .filter(Boolean)
    .filter((tok) => tok !== "DEFAULT"); // "default" is the legacy provider, covered by OIDC_ISSUER_URL
  return ids.some(
    (tok) =>
      isSet(env[`OIDC_${tok}_ISSUER_URL`]) &&
      isSet(env[`OIDC_${tok}_CLIENT_ID`]) &&
      isSet(env[`OIDC_${tok}_CLIENT_SECRET`]),
  );
}

/** True when all five required generic-OAuth2 vars are set (mirrors lib/oauth2.ts `oauth2Config`). */
function oauth2Configured(env: Env): boolean {
  return (
    isSet(env["OAUTH2_AUTH_URL"]) &&
    isSet(env["OAUTH2_TOKEN_URL"]) &&
    isSet(env["OAUTH2_USERINFO_URL"]) &&
    isSet(env["OAUTH2_CLIENT_ID"]) &&
    isSet(env["OAUTH2_CLIENT_SECRET"])
  );
}

/** True when SAML's three hard requirements are present (mirrors lib/saml.ts `samlConfigStatusFrom`):
 *  an IdP entry point, the IdP cert, and an ACS callback URL (explicit or derived from PUBLIC_URL). */
function samlConfigured(env: Env): boolean {
  const entryPoint = isSet(env["SAML_IDP_ENTRY_POINT"]) || isSet(env["SAML_ENTRY_POINT"]);
  const idpCert = isSet(env["SAML_IDP_CERT"]);
  const callbackUrl = isSet(env["SAML_CALLBACK_URL"]) || isSet(env["PUBLIC_URL"]);
  return entryPoint && idpCert && callbackUrl;
}

/**
 * Pure decision: is this env a DEMO (no-real-auth, every-session-admin) deployment? Returns false as
 * soon as ANY real method is configured — legacy OIDC, named OIDC, OAuth2, SAML, or magic-link.
 * Erring toward non-demo is the safe default: demo is the elevated-grant state, so it must require
 * the genuine absence of every auth signal. Exported so the boot self-check enforces the SAME rule
 * the runtime gate applies.
 */
export function isDemoAuthFrom(env: Env): boolean {
  // Legacy single-provider intent counts even when issuer-only (partial) — the safe direction.
  if (isSet(env["OIDC_ISSUER_URL"])) return false;
  if (namedOidcConfigured(env)) return false;
  if (oauth2Configured(env)) return false;
  if (samlConfigured(env)) return false;
  // Magic-link is a real login method; it is only ever enabled when no OIDC/SAML is present (all
  // excluded above), so its env flag alone is sufficient here.
  if (isTruthy(env["MAGIC_LINK_ENABLED"])) return false;
  return true;
}

/** Runtime gate: is the live process in demo auth mode? Delegates to the pure `isDemoAuthFrom` so the
 *  gate and the boot-time blocker share one definition and can never drift. */
export function isDemoAuth(): boolean {
  return isDemoAuthFrom(process.env);
}
