import { test, after } from "node:test";
import assert from "node:assert/strict";
import { deploymentProfile, profilePosture, requireTls, acceptDemoAuth, demoAuthSeverity, setRuntimeProfile, profileCatalogue } from "./deployment-profile";

/**
 * Deployment profile — lets small orgs (SME / charity / self-hoster) relax enterprise
 * couplings (TLS, no-IdP) by an explicit, recorded choice.
 */
test("defaults to business; unknown values fall back to business", () => {
  assert.equal(deploymentProfile({}), "business");
  assert.equal(deploymentProfile({ DEPLOYMENT_PROFILE: "nonsense" }), "business");
  assert.equal(deploymentProfile({ DEPLOYMENT_PROFILE: "self-hosted" }), "self-hosted");
});

test("default (business) profile preserves today's TLS behaviour: secure in production", () => {
  assert.equal(requireTls({ NODE_ENV: "production" }), true);
  assert.equal(requireTls({ NODE_ENV: "development" }), false);
});

test("a self-hoster/charity can run production-stable on plain HTTP (no secure-cookie break)", () => {
  assert.equal(requireTls({ NODE_ENV: "production", DEPLOYMENT_PROFILE: "self-hosted" }), false);
  assert.equal(requireTls({ NODE_ENV: "production", DEPLOYMENT_PROFILE: "nonprofit" }), false);
});

test("explicit PUBLIC_TLS overrides the profile either way", () => {
  assert.equal(requireTls({ DEPLOYMENT_PROFILE: "self-hosted", PUBLIC_TLS: "1" }), true);
  assert.equal(requireTls({ NODE_ENV: "production", DEPLOYMENT_PROFILE: "enterprise", PUBLIC_TLS: "0" }), false);
});

test("no-IdP severity scales with the profile, and an explicit accept downgrades it", () => {
  assert.equal(demoAuthSeverity({ DEPLOYMENT_PROFILE: "enterprise" }), "critical");
  assert.equal(demoAuthSeverity({ DEPLOYMENT_PROFILE: "business" }), "critical");
  assert.equal(demoAuthSeverity({ DEPLOYMENT_PROFILE: "nonprofit" }), "warn");
  assert.equal(demoAuthSeverity({ DEPLOYMENT_PROFILE: "self-hosted" }), "warn");
  assert.equal(demoAuthSeverity({ DEPLOYMENT_PROFILE: "demo" }), "info");
  // An enterprise that explicitly accepts demo auth is no longer blocked by it.
  assert.equal(acceptDemoAuth({ ACCEPT_DEMO_AUTH: "1" }), true);
  assert.equal(demoAuthSeverity({ DEPLOYMENT_PROFILE: "enterprise", ACCEPT_DEMO_AUTH: "1" }), "info");
});

test("posture carries a label + recommendations per profile", () => {
  assert.match(profilePosture({ DEPLOYMENT_PROFILE: "nonprofit" }).label, /charity/i);
  assert.ok(profilePosture({ DEPLOYMENT_PROFILE: "enterprise" }).recommend.length > 0);
});

test("the runtime override (wizard choice) drives the no-arg accessors", () => {
  setRuntimeProfile("self-hosted");
  assert.equal(deploymentProfile(), "self-hosted");
  assert.equal(requireTls(), false); // lan-ok ⇒ HTTP fine even without env
  assert.equal(demoAuthSeverity(), "warn");
  // An explicit env object still bypasses the override (pure path for the boot check).
  assert.equal(deploymentProfile({ DEPLOYMENT_PROFILE: "enterprise" }), "enterprise");
});
after(() => setRuntimeProfile(null));

test("the catalogue carries a preset (audience + suggested env) for every customer type", () => {
  const cat = profileCatalogue();
  for (const p of ["enterprise", "business", "nonprofit", "self-hosted", "demo"] as const) {
    assert.ok(cat[p].audience.length > 0, p);
    assert.ok(Array.isArray(cat[p].presetEnv), p);
  }
  assert.ok(cat.enterprise.presetEnv.some((e) => e.key === "SCIM_TOKEN"));
});
