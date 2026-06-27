import { test } from "node:test";
import assert from "node:assert/strict";
import { devModeActive, productionSignals, evaluateDevModeGuard, runDevModeGuard } from "./dev-mode-guard";

/**
 * The dev-mode production guard — the interlock that stops a dev/debug instance
 * (which can impersonate users + toggle paid features) from booting where it could
 * be reached. These are pure over an env map, so no process.env juggling.
 */

const silentLogger = { error() {}, warn() {}, info() {} };

test("a clean dev box (no production signals) boots fine", () => {
  const env = { NODE_ENV: "development", OMNI_DEV_MODE: "1", PUBLIC_URL: "http://localhost:3000" };
  const r = evaluateDevModeGuard(env);
  assert.equal(r.devMode, true);
  assert.deepEqual(r.signals, []);
  assert.equal(r.refuse, false);
  assert.doesNotThrow(() => runDevModeGuard(env, silentLogger));
});

test("dev mode + real OIDC refuses to boot", () => {
  const env = { NODE_ENV: "development", OMNI_DEV_MODE: "1", OIDC_ISSUER_URL: "https://sso.acme.com/app/o/x/" };
  const r = evaluateDevModeGuard(env);
  assert.equal(r.refuse, true);
  assert.match(r.signals.join(), /OIDC/);
  assert.throws(() => runDevModeGuard(env, silentLogger), /REFUSING|must not run|production/i);
});

test("dev mode + a licence refuses to boot", () => {
  const env = { NODE_ENV: "development", BROKER_TRACE: "1", LICENSE_KEY: "eyJ..." };
  assert.equal(evaluateDevModeGuard(env).refuse, true);
  assert.throws(() => runDevModeGuard(env, silentLogger));
});

test("dev mode + a non-local PUBLIC_URL refuses to boot", () => {
  const env = { NODE_ENV: "development", OMNI_DEV_MODE: "1", PUBLIC_URL: "https://app.acme.com" };
  const r = evaluateDevModeGuard(env);
  assert.equal(r.refuse, true);
  assert.match(r.signals.join(), /non-local/);
});

test("a *.local / localhost PUBLIC_URL is not a production signal", () => {
  for (const url of ["https://app.local", "http://localhost:3000", "http://127.0.0.1:3000", "https://omni.localhost"]) {
    assert.deepEqual(productionSignals({ PUBLIC_URL: url }), [], `${url} should be local`);
  }
});

test("the explicit acknowledgement downgrades refusal to a warning (never silent)", () => {
  const env = { NODE_ENV: "development", OMNI_DEV_MODE: "1", OIDC_ISSUER_URL: "https://sso.acme.com/", OMNI_DEV_MODE_ACK_INSECURE: "1" };
  const r = evaluateDevModeGuard(env);
  assert.equal(r.acknowledged, true);
  assert.equal(r.refuse, false);
  let warned = false;
  runDevModeGuard(env, { error() {}, info() {}, warn() { warned = true; } });
  assert.equal(warned, true, "must still warn loudly under acknowledgement");
});

test("production NODE_ENV means dev mode is inactive, so the guard is a no-op", () => {
  const env = { NODE_ENV: "production", OMNI_DEV_MODE: "1", OIDC_ISSUER_URL: "https://sso.acme.com/" };
  assert.equal(devModeActive(env), false);
  assert.equal(evaluateDevModeGuard(env).refuse, false);
  assert.doesNotThrow(() => runDevModeGuard(env, silentLogger));
});
