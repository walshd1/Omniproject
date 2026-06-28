import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDevEntitlementOverrides, setDevEntitlementOverride, clearDevEntitlementOverrides, getDevEntitlementOverrides } from "./dev-entitlements";
import { resolveLicense, LICENSE_FEATURES, isEntitled } from "./license";

/**
 * Dev-mode entitlement overrides — force paid features on/off in dev, inert in prod.
 */
const ALL = LICENSE_FEATURES;

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    clearDevEntitlementOverrides();
  }
}

test("CI guard: overrides are inert in production", () => {
  withEnv({ NODE_ENV: "production", OMNI_DEV_MODE: "1" }, () => {
    setDevEntitlementOverride("branding", false);
    // no change in prod, regardless of the override
    assert.deepEqual(applyDevEntitlementOverrides(ALL, ALL), ALL);
  });
});

test("in dev mode, an override revokes a feature", () => {
  withEnv({ NODE_ENV: "development", OMNI_DEV_MODE: "1", PREMIUM_ENFORCEMENT: undefined }, () => {
    // pre-community grants everything by default
    assert.equal(isEntitled("branding"), true);
    setDevEntitlementOverride("branding", false);
    assert.equal(resolveLicense().features.includes("branding"), false);
    assert.equal(isEntitled("branding"), false);
    // other features untouched
    assert.equal(isEntitled("webhooks"), true);
  });
});

test("in dev mode, an override grants a feature that enforcement would withhold", () => {
  withEnv({ NODE_ENV: "development", OMNI_DEV_MODE: "1", PREMIUM_ENFORCEMENT: "on", LICENSE_KEY: undefined, LICENSE_DEV_FEATURES: undefined }, () => {
    // enforced + no licence ⇒ nothing granted
    assert.equal(isEntitled("labels"), false);
    setDevEntitlementOverride("labels", true);
    assert.equal(isEntitled("labels"), true);
  });
});

test("clearing an override restores the base entitlement; null clears one", () => {
  withEnv({ NODE_ENV: "development", OMNI_DEV_MODE: "1" }, () => {
    setDevEntitlementOverride("branding", false);
    assert.equal(getDevEntitlementOverrides()["branding"], false);
    setDevEntitlementOverride("branding", null);
    assert.equal("branding" in getDevEntitlementOverrides(), false);
    assert.equal(isEntitled("branding"), true);
  });
});

test("the result stays a stable subset of the catalogue", () => {
  withEnv({ NODE_ENV: "development", OMNI_DEV_MODE: "1" }, () => {
    setDevEntitlementOverride("not-a-feature", true);
    const out = applyDevEntitlementOverrides(ALL, ALL);
    assert.ok(out.every((f) => ALL.includes(f)));
  });
});
