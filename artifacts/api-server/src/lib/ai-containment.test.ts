import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { isLocalHost, classifyEndpointLocality, aiContainmentLevel, aiSourceLevel, setContainmentRelax, getContainmentRelax, __resetContainmentRelax } from "./ai-containment";
import { assertGrantContainment, type AutonomousWriteGrant } from "./autonomous-grant";
import { AutonomousWriteDenied } from "./autonomous-grant";

/**
 * AI exposure → containment: the more exposed the AI, the tighter an autonomous write
 * grant must be. Public/remote forbid wildcards and mandate a time bound + write cap.
 */
afterEach(() => __resetContainmentRelax());

test("DEFAULT is FULL containment for all sources (relax floor = public)", () => {
  assert.equal(getContainmentRelax(), "public");
  // AI source is off in tests, but the enforced level is the strictest of (relax, source).
  assert.equal(aiSourceLevel(), "off");
  assert.equal(aiContainmentLevel(), "public");
});

test("an admin can relax, but never below the AI source floor", () => {
  setContainmentRelax("off"); // fully relaxed
  assert.equal(aiContainmentLevel(), "off"); // source is off in tests ⇒ off
  setContainmentRelax("local");
  assert.equal(aiContainmentLevel(), "local"); // at least local
});

test("local vs remote host classification", () => {
  for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.0.1", "box.local"]) assert.equal(isLocalHost(h), true, h);
  for (const h of ["api.openai.com", "8.8.8.8", "203.0.113.4", "172.32.0.1"]) assert.equal(isLocalHost(h), false, h);
  assert.equal(classifyEndpointLocality("http://localhost:11434"), "local");
  assert.equal(classifyEndpointLocality("https://api.openai.com/v1"), "remote");
  assert.equal(classifyEndpointLocality(null), "remote"); // unknown ⇒ stricter
});

const narrow: AutonomousWriteGrant = {
  actorId: "health-watch", actions: ["update_issue"],
  projects: ["P1"], surfaces: ["delivery"], fields: ["status"], notAfter: 9_999_999_999_999, maxWrites: 5,
};

test("off / local-with-narrow grants pass", () => {
  assert.doesNotThrow(() => assertGrantContainment(narrow, "off"));
  assert.doesNotThrow(() => assertGrantContainment(narrow, "local"));
  assert.doesNotThrow(() => assertGrantContainment(narrow, "public"));
});

test("public/remote REJECT any wildcard or unspecified scope", () => {
  for (const level of ["public", "remote"] as const) {
    assert.throws(() => assertGrantContainment({ ...narrow, projects: ["*"] }, level), AutonomousWriteDenied);
    assert.throws(() => assertGrantContainment({ ...narrow, surfaces: undefined }, level), AutonomousWriteDenied);
    assert.throws(() => assertGrantContainment({ ...narrow, fields: ["*"] }, level), AutonomousWriteDenied);
  }
});

test("public/remote REQUIRE a time bound and a write cap", () => {
  assert.throws(() => assertGrantContainment({ ...narrow, notAfter: undefined }, "public"), AutonomousWriteDenied);
  assert.throws(() => assertGrantContainment({ ...narrow, maxWrites: undefined }, "remote"), AutonomousWriteDenied);
});

test("local ALLOWS a broad scope only with an explicit allowBroad opt-in", () => {
  const broad: AutonomousWriteGrant = { actorId: "x", actions: ["update_issue"], projects: ["*"] };
  assert.throws(() => assertGrantContainment(broad, "local"), AutonomousWriteDenied);
  assert.doesNotThrow(() => assertGrantContainment({ ...broad, allowBroad: true }, "local"));
  // …but allowBroad does NOT rescue a broad grant under remote/public.
  assert.throws(() => assertGrantContainment({ ...broad, allowBroad: true }, "public"), AutonomousWriteDenied);
});
