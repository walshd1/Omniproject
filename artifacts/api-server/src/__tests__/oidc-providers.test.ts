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

const { oidcProviders, oidcConfig, isOidcConfigured, getOidcProvider, oidcProviderList, authorizeUrl } =
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

test("authorizeUrl builds the per-provider authorize request (S256 PKCE + nonce)", () => {
  const provider = getOidcProvider("google")!;
  const url = new URL(
    authorizeUrl({
      provider,
      discovery: { authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth", token_endpoint: "x" },
      redirectUri: "https://app.test/api/auth/callback",
      state: "st",
      nonce: "no",
      verifier: "ver",
    }),
  );
  assert.equal(url.searchParams.get("client_id"), "g-client");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("nonce"), "no");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok((url.searchParams.get("code_challenge") || "").length > 0);
  assert.equal(url.searchParams.get("prompt"), null); // no step-up prompt unless requested
});

test("authorizeUrl with prompt:login forces a fresh credential prompt (step-up)", () => {
  const provider = getOidcProvider("default")!;
  const url = new URL(
    authorizeUrl({
      provider,
      discovery: { authorization_endpoint: "https://legacy.test/auth", token_endpoint: "x" },
      redirectUri: "https://app.test/api/auth/callback",
      state: "st",
      nonce: "no",
      verifier: "ver",
      prompt: "login",
    }),
  );
  assert.equal(url.searchParams.get("prompt"), "login");
  assert.equal(url.searchParams.get("max_age"), "0");
});
