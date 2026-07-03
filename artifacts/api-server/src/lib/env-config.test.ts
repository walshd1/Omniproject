import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { envStr, envInt, envEnum, envUrl, checkRequiredEnv, detectEnvVarTypos } from "./env-config";

afterEach(() => { for (const k of ["X_STR", "X_INT", "X_ENUM", "X_URL"]) delete process.env[k]; });

test("envStr trims and falls back", () => {
  process.env["X_STR"] = "  hi  ";
  assert.equal(envStr("X_STR"), "hi");
  assert.equal(envStr("X_MISSING", "def"), "def");
});

test("envInt validates integer + range, else falls back", () => {
  process.env["X_INT"] = "7";
  assert.equal(envInt("X_INT", 0, { min: 1, max: 10 }), 7);
  process.env["X_INT"] = "99"; assert.equal(envInt("X_INT", 0, { max: 10 }), 0); // out of range → fallback
  process.env["X_INT"] = "1.5"; assert.equal(envInt("X_INT", 3), 3);            // not integer → fallback
});

test("envEnum + envUrl enforce their rule", () => {
  process.env["X_ENUM"] = "b";
  assert.equal(envEnum("X_ENUM", ["a", "b"] as const, "a"), "b");
  process.env["X_ENUM"] = "z"; assert.equal(envEnum("X_ENUM", ["a", "b"] as const, "a"), "a");
  process.env["X_URL"] = "https://example.com"; assert.equal(envUrl("X_URL"), "https://example.com");
  process.env["X_URL"] = "http://169.254.169.254/"; assert.equal(envUrl("X_URL"), undefined); // metadata blocked
});

test("checkRequiredEnv: clean in dev, flags weak prod config", () => {
  assert.deepEqual(checkRequiredEnv({ NODE_ENV: "development" }), []);
  const issues = checkRequiredEnv({ NODE_ENV: "production", SCIM_TOKEN: "short", RATE_LIMIT_DISABLED: "true" });
  assert.match(issues.join(" "), /SCIM_TOKEN/);
  assert.match(issues.join(" "), /RATE_LIMIT_DISABLED/);
  // A well-configured prod deployment is clean.
  assert.deepEqual(checkRequiredEnv({ NODE_ENV: "production", SESSION_SECRET: "a-strong-secret-value-1234" }), []);
});

test("checkRequiredEnv: OIDC_SKIP_TOKEN_VERIFY left on in production is a critical finding (auth bypass)", () => {
  const issues = checkRequiredEnv({ NODE_ENV: "production", OIDC_SKIP_TOKEN_VERIFY: "true" });
  assert.match(issues.join(" "), /OIDC_SKIP_TOKEN_VERIFY/);
  assert.deepEqual(checkRequiredEnv({ NODE_ENV: "production", OIDC_SKIP_TOKEN_VERIFY: "false" }), []);
  assert.deepEqual(checkRequiredEnv({ NODE_ENV: "development", OIDC_SKIP_TOKEN_VERIFY: "true" }), []);
});

test("checkRequiredEnv: also runs when NODE_ENV isn't literally 'production' but production signals are present", () => {
  // A real OIDC issuer configured (a production signal) with a weak SCIM token, NODE_ENV unset —
  // this must NOT be silently skipped just because NODE_ENV isn't the exact string "production".
  const issues = checkRequiredEnv({ OIDC_ISSUER_URL: "https://idp.example.com", SCIM_TOKEN: "short" });
  assert.match(issues.join(" "), /SCIM_TOKEN/);
  // No production signals at all ⇒ unchanged (plain dev/test stays relaxed).
  assert.deepEqual(checkRequiredEnv({ NODE_ENV: "development", SCIM_TOKEN: "short" }), []);
});

test("detectEnvVarTypos: flags a near-miss on a known var, ignores unrelated env", () => {
  // The exact bug class this closes: OIDC_ISSUER_URL misspelled as OIDC_ISUER_URL silently
  // never took effect (no OIDC config, no error) — this must surface it as a likely typo.
  const issues = detectEnvVarTypos({ OIDC_ISUER_URL: "https://idp.example.com" });
  assert.equal(issues.length, 1);
  assert.match(issues[0]!, /OIDC_ISUER_URL/);
  assert.match(issues[0]!, /OIDC_ISSUER_URL/);
  // Unrelated host/platform env vars (no known var shares their leading word) are never touched,
  // even ones that are superficially "close" to something — this must not be noisy.
  assert.deepEqual(detectEnvVarTypos({ PATH: "/usr/bin", DATABASE_URL: "postgres://x", HOME: "/root" }), []);
  // An exact match on a known var is never flagged as its own typo.
  assert.deepEqual(detectEnvVarTypos({ OIDC_ISSUER_URL: "https://idp.example.com" }), []);
  // A wildly different suffix on the same leading word is NOT a typo (too far to guess at).
  assert.deepEqual(detectEnvVarTypos({ OIDC_COMPLETELY_UNRELATED_THING: "x" }), []);
});

test("checkRequiredEnv: a partially-configured SAML rollout is flagged in prod, complete is clean", () => {
  const partial = checkRequiredEnv({ NODE_ENV: "production", SAML_IDP_ENTRY_POINT: "https://idp/sso" });
  assert.match(partial.join(" "), /SAML SSO is partially configured/);
  assert.match(partial.join(" "), /SAML_IDP_CERT/);
  // Fully configured SAML raises no issue.
  assert.deepEqual(
    checkRequiredEnv({ NODE_ENV: "production", SAML_IDP_ENTRY_POINT: "https://idp/sso", SAML_IDP_CERT: "cert", PUBLIC_URL: "https://omni.example.com" }),
    [],
  );
});
