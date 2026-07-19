import { isTruthy } from "./env-config";
import { localUsersActive } from "./user-directory";

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
  // Native in-app users are a real login method too. `LOCAL_USERS_ENABLED` lets an operator DECLARE the intent
  // up front (so the boot self-check passes and demo is off even before the first account exists); the runtime
  // gate additionally turns demo off once a local user actually exists (see `isDemoAuth`).
  if (isTruthy(env["LOCAL_USERS_ENABLED"])) return false;
  return true;
}

/**
 * Runtime gate: is the live process in demo auth mode? Starts from the pure env decision (shared with the boot
 * self-check) AND additionally turns demo OFF once ≥1 active local user exists — so creating the first in-app
 * admin in the setup wizard immediately stops "no IdP = everyone admin", without needing an env change.
 */
export function isDemoAuth(): boolean {
  if (!isDemoAuthFrom(process.env)) return false;
  return !localUsersActive();
}

// ── In-app (local password) tier gating — downgrade prevention ────────────────────────────────────────────────
// Native in-app users are the ENTRY tier (solo/homelab), BELOW an external-container backend and BELOW enterprise
// OIDC/SSO. Once a STRONGER auth method (real SSO — OIDC / OAuth2 / SAML) is configured, local passwords are
// AUTOMATICALLY DISABLED, so an attacker who reaches the box can't sign in with a local password to bypass SSO
// (a downgrade attack). The ONLY way back to local passwords while SSO is configured is the host-side RECOVERY
// break-glass (`LOCAL_PASSWORD_RECOVERY`) — deliberately DESTRUCTIVE: it re-keys the credential store domain
// (see lib/user-credentials `credKey`), so the existing sealed credentials become unreadable and you must start
// afresh or restore from backup. That cost is the point: recovery can't be a stealth downgrade.

/** True when a STRONGER-than-local real SSO method (legacy/named OIDC, OAuth2, or SAML) is configured. Magic-link
 *  is passwordless-but-same-tier and does NOT, by itself, disable local passwords. */
export function strongerAuthConfigured(env: Env = process.env): boolean {
  if (isSet(env["OIDC_ISSUER_URL"])) return true;
  if (namedOidcConfigured(env)) return true;
  if (oauth2Configured(env)) return true;
  if (samlConfigured(env)) return true;
  return false;
}

/** The host-side RECOVERY break-glass: force local passwords back on despite a configured SSO. DESTRUCTIVE — it
 *  re-keys the credential store, invalidating existing local credentials (start afresh / restore from backup). */
export function localPasswordRecovery(env: Env = process.env): boolean {
  return isTruthy(env["LOCAL_PASSWORD_RECOVERY"]);
}

/** Whether local (in-app password) sign-in is ALLOWED at all: only when no stronger SSO is configured, UNLESS the
 *  destructive recovery break-glass is engaged. This is the downgrade-prevention gate every local-auth surface
 *  (login, bootstrap, /auth/me, the users admin plane) consults — separate from whether the store is configured. */
export function localPasswordsAllowed(env: Env = process.env): boolean {
  return localPasswordRecovery(env) || !strongerAuthConfigured(env);
}
