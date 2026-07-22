import { test } from "node:test";
import assert from "node:assert/strict";
import { isProductionEnv } from "./node-env";

/**
 * `isProductionEnv` is the single fail-safe production predicate that every dev/debug
 * gate keys off. The contract: only an explicit `development`/`test` (any case, trimmed)
 * or an unset/empty NODE_ENV reads as non-production; EVERYTHING else — a mis-cased
 * "Production", "staging", "prod", a typo — must read as production so dev surfaces stay off.
 */

test("explicit non-production values (any case / whitespace) are NOT production", () => {
  for (const v of ["development", "test", "Development", "TEST", "  development  ", "\tdevelopment\n", "Test"]) {
    assert.equal(isProductionEnv({ NODE_ENV: v }), false, `${JSON.stringify(v)} should be non-production`);
  }
});

test("unset / empty NODE_ENV is treated as non-production (the local / CI / node --test default)", () => {
  assert.equal(isProductionEnv({}), false);
  assert.equal(isProductionEnv({ NODE_ENV: undefined }), false);
  assert.equal(isProductionEnv({ NODE_ENV: "" }), false);
  assert.equal(isProductionEnv({ NODE_ENV: "   " }), false); // whitespace-only trims to empty
});

test("production is detected regardless of case or surrounding whitespace (the historical blind spot)", () => {
  for (const v of ["production", "Production", "PRODUCTION", "ProDuCtIoN", "  production", "production\n", "\tproduction\t"]) {
    assert.equal(isProductionEnv({ NODE_ENV: v }), true, `${JSON.stringify(v)} must read as production`);
  }
});

test("any OTHER non-empty value fails closed to production (staging, prod, typos, unknown)", () => {
  for (const v of ["staging", "prod", "preprod", "prod-1", "qa", "uat", "productio", "prd", "live", "release", "garbage"]) {
    assert.equal(isProductionEnv({ NODE_ENV: v }), true, `${JSON.stringify(v)} must fail closed to production`);
  }
});

test("defaults to reading process.env when no argument is passed", () => {
  // Just prove it doesn't throw and returns a boolean over the real environment.
  assert.equal(typeof isProductionEnv(), "boolean");
});
