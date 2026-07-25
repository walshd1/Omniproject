import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DELEGATION_POLICY, isDelegationAllowed, levelDepth, cleanDelegationPolicy,
} from "./delegation-policy";

test("the default policy delegates nothing below the org", () => {
  assert.deepEqual(DEFAULT_DELEGATION_POLICY, { ruleset: "org", settings: "org", methodologyComposition: "org" });
});

test("levelDepth orders org < programme < project < user; unknown → org", () => {
  assert.equal(levelDepth("org"), 0);
  assert.equal(levelDepth("programme"), 1);
  assert.equal(levelDepth("project"), 2);
  assert.equal(levelDepth("user"), 3);
  assert.equal(levelDepth("nonsense"), 0);
});

test("isDelegationAllowed: an org write is always allowed", () => {
  assert.equal(isDelegationAllowed("org", "org"), true);
  assert.equal(isDelegationAllowed("project", "org"), true);
});

test("isDelegationAllowed: a deeper write needs the policy to reach that depth", () => {
  // policy = org → nothing below org
  assert.equal(isDelegationAllowed("org", "programme"), false);
  assert.equal(isDelegationAllowed("org", "project"), false);
  // policy = programme → programme yes, project no
  assert.equal(isDelegationAllowed("programme", "programme"), true);
  assert.equal(isDelegationAllowed("programme", "project"), false);
  // policy = project → down to project, but not user
  assert.equal(isDelegationAllowed("project", "programme"), true);
  assert.equal(isDelegationAllowed("project", "project"), true);
  assert.equal(isDelegationAllowed("project", "user"), false);
  // policy = user (rare) → the deepest, everything allowed
  assert.equal(isDelegationAllowed("user", "project"), true);
  assert.equal(isDelegationAllowed("user", "user"), true);
});

test("cleanDelegationPolicy fills unknowns from the default and drops invalid levels", () => {
  assert.deepEqual(
    cleanDelegationPolicy({ ruleset: "programme", settings: "galaxy", methodologyComposition: "project" }),
    { ruleset: "programme", settings: "org", methodologyComposition: "project" },
  );
  assert.deepEqual(cleanDelegationPolicy(null), DEFAULT_DELEGATION_POLICY);
  assert.deepEqual(cleanDelegationPolicy("nope"), DEFAULT_DELEGATION_POLICY);
});
