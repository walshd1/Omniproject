import { test } from "node:test";
import assert from "node:assert/strict";
import { BACKENDS } from "./backend-catalogue";
import { BROKERS } from "./broker-catalogue";
import {
  deriveBackendKeyFormat,
  backendKeyFormat,
  brokerKeyFormat,
  isKeyless,
  BROKER_DEFAULT_KEY_FORMAT,
} from "./key-format";

test("per-user impersonation backends require the caller's own bearer (no operator env)", () => {
  const kf = deriveBackendKeyFormat({ authHeader: "=Bearer {{ $json.body.payload.userContext.token }}", requiredEnv: [] });
  assert.equal(kf.scheme, "per-user");
  assert.equal(kf.header, "Authorization");
  assert.equal(kf.env, undefined);
});

test("env-backed Basic/Bearer headers carry their env var", () => {
  const basic = deriveBackendKeyFormat({ authHeader: "=Basic {{ $env.JIRA_BASIC_AUTH }}", requiredEnv: ["JIRA_BASIC_AUTH"] });
  assert.deepEqual(basic, { scheme: "basic", header: "Authorization", env: ["JIRA_BASIC_AUTH"] });
  const bearer = deriveBackendKeyFormat({ authHeader: "=Bearer {{ $env.SMARTSHEET_TOKEN }}", requiredEnv: ["SMARTSHEET_TOKEN"] });
  assert.deepEqual(bearer, { scheme: "bearer", header: "Authorization", env: ["SMARTSHEET_TOKEN"] });
});

test("broker-managed credential ⇒ scheme inferred from the credential type name", () => {
  assert.equal(deriveBackendKeyFormat({ authHeader: "", credentialType: "salesforceOAuth2Api", requiredEnv: [] }).scheme, "oauth2");
  assert.equal(deriveBackendKeyFormat({ authHeader: "", credentialType: "serviceNowBasicApi", requiredEnv: [] }).scheme, "basic");
  assert.equal(deriveBackendKeyFormat({ authHeader: "", credentialType: "zendeskApi", requiredEnv: [] }).scheme, "apiKey");
});

test("one-shot import sources are keyless", () => {
  const kf = deriveBackendKeyFormat({ authHeader: "", requiredEnv: [], kind: "import" });
  assert.equal(kf.scheme, "none");
  assert.ok(isKeyless(kf));
});

test("an explicit keyFormat in the JSON overrides derivation", () => {
  const def = { authHeader: "", requiredEnv: [], keyFormat: { scheme: "apiKey" as const, header: "X-Api-Key" } };
  // backendKeyFormat takes the explicit block verbatim.
  assert.deepEqual(backendKeyFormat(def as never), { scheme: "apiKey", header: "X-Api-Key" });
});

test("every backend resolves to a concrete key format with a known scheme", () => {
  const schemes = new Set(["psk", "bearer", "apiKey", "basic", "oauth2", "per-user", "none"]);
  for (const b of BACKENDS) {
    const kf = backendKeyFormat(b);
    assert.ok(schemes.has(kf.scheme), `${b.id} → unknown scheme ${kf.scheme}`);
  }
});

test("every broker carries an explicit PSK key format (BROKER_PSK over X-Omni-Sig)", () => {
  for (const b of BROKERS) {
    const kf = brokerKeyFormat(b);
    assert.equal(kf.scheme, "psk", `${b.id} broker should be PSK-keyed`);
    assert.deepEqual(kf.env, ["BROKER_PSK"]);
    assert.equal(kf.header, "X-Omni-Sig");
  }
});

test("brokerKeyFormat falls back to the BROKER_PSK default when unset", () => {
  assert.deepEqual(brokerKeyFormat({}), BROKER_DEFAULT_KEY_FORMAT);
});
