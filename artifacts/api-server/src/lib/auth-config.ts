import { isOidcConfigured } from "./oidc";
import { isOAuth2Configured } from "./oauth2";
import { isSamlConfigured } from "./saml";
import { magicLinkEnabled } from "./magic-link";

/**
 * Is the gateway running in DEMO auth mode — i.e. NO real authentication method is configured at all?
 *
 * Demo mode grants every session full access so the product is usable out of the box (there's no real
 * identity to phish). It MUST therefore be inferred from the absence of *every* real login method, not
 * from a single legacy env var. The previous check (`!OIDC_ISSUER_URL`) mis-fired for every modern
 * deployment that leaves that legacy var unset — named OIDC providers, SAML, OAuth2, and magic-link —
 * silently elevating every authenticated user to full admin. `isOidcConfigured` already covers both the
 * legacy `OIDC_ISSUER_URL` and named `OIDC_PROVIDERS` forms.
 */
export function isDemoAuth(): boolean {
  // Non-demo if ANY real auth method is present. The legacy single-provider var is checked LIVE so a
  // runtime-set or partial (issuer-only) legacy config still counts as auth intent; the module-load
  // provider registries cover complete named-OIDC / SAML / OAuth2 / magic-link setups. Erring toward
  // non-demo is the safe default — demo mode is the elevated-grant state, so it must require the
  // genuine absence of every auth signal, not the absence of one legacy var.
  if (process.env["OIDC_ISSUER_URL"]?.trim()) return false;
  return !isOidcConfigured && !isOAuth2Configured && !isSamlConfigured() && !magicLinkEnabled();
}
