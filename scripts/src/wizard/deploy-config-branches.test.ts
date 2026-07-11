import { test } from "node:test";
import assert from "node:assert/strict";
import { publicHost, envMap, renderCompose, type DeployConfig } from "./deploy-config";

function base(over: Partial<DeployConfig> = {}): DeployConfig {
  return {
    publicUrl: "https://omni.example.com",
    port: 3000,
    sessionSecret: "a-strong-secret",
    broker: { backendId: "jira", bundleReferenceBroker: true, brokerUrl: "" },
    idp: { kind: "oidc", issuerUrl: "https://idp/realm", clientId: "omni", clientSecret: "shh" },
    ai: { provider: "none" },
    ...over,
  };
}

test("publicHost extracts the host from a well-formed URL", () => {
  assert.equal(publicHost(base({ publicUrl: "https://omni.example.com:8443/app" })), "omni.example.com:8443");
});

test("publicHost falls back to string-stripping when the URL can't be parsed", () => {
  // Not a parseable URL → the catch branch strips scheme + path manually.
  assert.equal(publicHost(base({ publicUrl: "not a url/with spaces/x" })), "not a url");
  assert.equal(publicHost(base({ publicUrl: "http://bare-host/path/deep" })), "bare-host");
});

test("envMap emits Authentik secrets for the bundled-IdP path", () => {
  const env = envMap(base({
    idp: { kind: "authentik-bundled", issuerUrl: "https://idp/x", clientId: "omni", clientSecret: "s", pgPassword: "pgpw", secretKey: "seckey" },
  }));
  assert.equal(env["AUTHENTIK_PG_PASSWORD"], "pgpw");
  assert.equal(env["AUTHENTIK_SECRET_KEY"], "seckey");
});

test("renderCompose wires OIDC issuer env for an external OIDC IdP", () => {
  const compose = renderCompose(base({ idp: { kind: "oidc", issuerUrl: "https://idp/realm", clientId: "omni", clientSecret: "shh" } }));
  assert.match(compose, /OIDC_ISSUER_URL:/);
  assert.match(compose, /OIDC_CLIENT_ID:/);
  assert.match(compose, /OIDC_CLIENT_SECRET:/);
});
