import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Regression for the demo-mode privilege-escalation: demo mode (which grants every session full
 * admin) must be inferred from the absence of EVERY real auth method — not from the legacy
 * `OIDC_ISSUER_URL` var alone. Here a real method (magic-link) is configured while the legacy var is
 * deliberately unset; the pre-fix `!OIDC_ISSUER_URL` check would report demo mode and elevate every
 * user to admin. Env is set before importing, since the auth-config inputs read env at module load.
 */
delete process.env["OIDC_ISSUER_URL"];
delete process.env["OIDC_PROVIDERS"];
process.env["MAGIC_LINK_ENABLED"] = "true";

const { isDemoAuth, isDemoAuthFrom, strongerAuthConfigured, localPasswordsAllowed } = await import("./auth-config");

test("downgrade prevention: local passwords are DISABLED once stronger SSO is configured", () => {
  // No SSO → local passwords allowed (the entry tier).
  assert.equal(strongerAuthConfigured({}), false);
  assert.equal(localPasswordsAllowed({}), true);
  // Magic-link is same-tier (passwordless) — it does NOT disable local passwords.
  assert.equal(localPasswordsAllowed({ MAGIC_LINK_ENABLED: "true" }), true);
  // A real SSO (OIDC/OAuth2/SAML) disables local passwords.
  assert.equal(strongerAuthConfigured({ OIDC_ISSUER_URL: "https://idp/realm" }), true);
  assert.equal(localPasswordsAllowed({ OIDC_ISSUER_URL: "https://idp/realm" }), false);
  // …unless the DESTRUCTIVE recovery break-glass is engaged.
  assert.equal(localPasswordsAllowed({ OIDC_ISSUER_URL: "https://idp/realm", LOCAL_PASSWORD_RECOVERY: "true" }), true);
});

test("isDemoAuth is FALSE when a real auth method is configured but the legacy OIDC_ISSUER_URL is unset", () => {
  // magic-link is a real login method; the gateway must NOT treat this as demo mode.
  assert.equal(isDemoAuth(), false);
});

// The pure detector is the single source of truth shared with the boot-time security self-check.
// Each real auth method — configured WITHOUT the legacy OIDC_ISSUER_URL — must read as non-demo, so a
// correctly-secured SAML/OAuth2/named-OIDC deployment is neither elevated-to-admin at runtime nor
// falsely refused boot as "demo auth in prod".
test("isDemoAuthFrom: true only when NO real auth method is configured", () => {
  assert.equal(isDemoAuthFrom({}), true);
  assert.equal(isDemoAuthFrom({ NODE_ENV: "production" }), true);
});

test("isDemoAuthFrom: legacy OIDC (issuer only) is non-demo", () => {
  assert.equal(isDemoAuthFrom({ OIDC_ISSUER_URL: "https://idp/realm" }), false);
});

test("isDemoAuthFrom: a COMPLETE named OIDC provider is non-demo; an incomplete one is still demo", () => {
  assert.equal(
    isDemoAuthFrom({
      OIDC_PROVIDERS: "google",
      OIDC_GOOGLE_ISSUER_URL: "https://accounts.google.com",
      OIDC_GOOGLE_CLIENT_ID: "abc",
      OIDC_GOOGLE_CLIENT_SECRET: "shh",
    }),
    false,
  );
  // Missing the client secret ⇒ the provider wouldn't actually load ⇒ still demo (safe direction).
  assert.equal(
    isDemoAuthFrom({ OIDC_PROVIDERS: "google", OIDC_GOOGLE_ISSUER_URL: "https://accounts.google.com", OIDC_GOOGLE_CLIENT_ID: "abc" }),
    true,
  );
});

test("isDemoAuthFrom: a fully-configured generic OAuth2 provider is non-demo", () => {
  assert.equal(
    isDemoAuthFrom({
      OAUTH2_AUTH_URL: "https://gh/login",
      OAUTH2_TOKEN_URL: "https://gh/token",
      OAUTH2_USERINFO_URL: "https://gh/user",
      OAUTH2_CLIENT_ID: "id",
      OAUTH2_CLIENT_SECRET: "secret",
    }),
    false,
  );
});

test("isDemoAuthFrom: a fully-configured SAML IdP is non-demo (the enterprise false-positive this fixes)", () => {
  assert.equal(
    isDemoAuthFrom({
      SAML_IDP_ENTRY_POINT: "https://idp/sso",
      SAML_IDP_CERT: "-----BEGIN CERTIFICATE-----abc-----END CERTIFICATE-----",
      SAML_CALLBACK_URL: "https://omni.example.com/api/auth/saml/callback",
    }),
    false,
  );
});
