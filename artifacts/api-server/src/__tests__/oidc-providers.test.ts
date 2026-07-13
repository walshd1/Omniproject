import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Multi-provider OIDC registry (lib/oidc). The provider list is built from env at module load,
 * so we set the env BEFORE importing — node's test runner gives each test file its own process,
 * so this does not leak into the other oidc tests.
 */
process.env["OIDC_ISSUER_URL"] = "https://legacy.test";
process.env["OIDC_CLIENT_ID"] = "legacy-client";
process.env["OIDC_CLIENT_SECRET"] = "legacy-secret";
process.env["OIDC_PROVIDERS"] = "google, microsoft";
process.env["OIDC_GOOGLE_ISSUER_URL"] = "https://accounts.google.com";
process.env["OIDC_GOOGLE_CLIENT_ID"] = "g-client";
process.env["OIDC_GOOGLE_CLIENT_SECRET"] = "g-secret";
process.env["OIDC_MICROSOFT_ISSUER_URL"] = "https://login.microsoftonline.com/tenant/v2.0";
process.env["OIDC_MICROSOFT_CLIENT_ID"] = "m-client";
process.env["OIDC_MICROSOFT_CLIENT_SECRET"] = "m-secret";
process.env["OIDC_MICROSOFT_LABEL"] = "Microsoft 365";

const { oidcProviders, oidcConfig, isOidcConfigured, getOidcProvider, oidcProviderList } =
  await import("../lib/oidc");

test("legacy single config becomes the 'default' provider, listed first", () => {
  assert.equal(isOidcConfigured, true);
  assert.equal(oidcConfig?.id, "default");
  assert.equal(oidcConfig?.issuerUrl, "https://legacy.test");
  assert.equal(oidcProviders[0]?.id, "default");
});

test("named providers are parsed from OIDC_PROVIDERS with per-id env", () => {
  const ids = oidcProviders.map((p) => p.id);
  assert.deepEqual(ids, ["default", "google", "microsoft"]);
  const google = getOidcProvider("google");
  assert.equal(google?.clientId, "g-client");
  assert.equal(google?.issuerUrl, "https://accounts.google.com");
  assert.equal(google?.audience, "g-client"); // defaults to clientId
  assert.equal(google?.label, "Google"); // capitalised id when no LABEL set
});

test("a provider's LABEL env overrides the default label", () => {
  assert.equal(getOidcProvider("microsoft")?.label, "Microsoft 365");
});

test("getOidcProvider falls back to the default for an unknown/absent id", () => {
  assert.equal(getOidcProvider("nope")?.id, "default");
  assert.equal(getOidcProvider()?.id, "default");
  assert.equal(getOidcProvider(null)?.id, "default");
});

test("oidcProviderList is secret-free (id + label + kind only)", () => {
  const list = oidcProviderList();
  assert.equal(list.length, 3);
  for (const p of list) {
    assert.equal(p.kind, "oidc");
    assert.ok(p.id && p.label);
    assert.doesNotMatch(JSON.stringify(p), /secret|client_secret|g-secret|m-secret/i);
  }
});

// The authorize-URL construction (S256 PKCE + nonce + prompt=login/max_age step-up) now runs through
// openid-client and is covered end-to-end in __tests__/oidc-helpers.test.ts against a mocked IdP.
