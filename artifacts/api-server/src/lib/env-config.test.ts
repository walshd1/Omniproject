import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { envStr, envInt, envEnum, envUrl, checkRequiredEnv } from "./env-config";

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
