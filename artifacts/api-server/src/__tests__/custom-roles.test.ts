import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeCustomRolesConfig, capabilitiesForCustomRoles, capabilitiesForClaims, customRolesForClaims,
  CUSTOM_ROLE_BASES, CustomRolesError, type CustomRolesConfig,
} from "../lib/custom-roles";

/**
 * Custom roles + permission sets (roadmap X.6) — the pure validator + resolution helpers. A custom role is
 * grounded in a fixed base role; a permission set bundles real governance capabilities. Referential integrity
 * (capabilities exist, permission sets referenced exist) is enforced.
 */

// A capability id that exists in the catalogue (AI tools are always present).
const CAP = "portfolio-insights";

const GOOD: CustomRolesConfig = {
  permissionSets: [{ id: "insights-pack", label: "Insights pack", description: "", capabilities: [CAP] }],
  customRoles: [{ id: "finance-analyst", label: "Finance Analyst", description: "", baseRole: "contributor", permissionSetIds: ["insights-pack"], groups: ["finance"] }],
};

test("base roles exclude guest (the invite-only floor)", () => {
  assert.ok(!CUSTOM_ROLE_BASES.includes("guest" as never));
  assert.ok(CUSTOM_ROLE_BASES.includes("contributor"));
  assert.ok(CUSTOM_ROLE_BASES.includes("admin"));
});

test("a well-formed config validates", () => {
  const c = sanitizeCustomRolesConfig(GOOD);
  assert.equal(c.permissionSets.length, 1);
  assert.equal(c.customRoles[0]!.baseRole, "contributor");
  assert.deepEqual(c.customRoles[0]!.groups, ["finance"]);
});

test("rejects: bad base role, built-in collision, unknown capability, dangling permission-set ref", () => {
  assert.throws(() => sanitizeCustomRolesConfig({ customRoles: [{ id: "x", label: "X", baseRole: "superuser" }] }), CustomRolesError);
  assert.throws(() => sanitizeCustomRolesConfig({ customRoles: [{ id: "admin", label: "X", baseRole: "manager" }] }), /collides with a built-in role/);
  assert.throws(() => sanitizeCustomRolesConfig({ permissionSets: [{ id: "p", label: "P", capabilities: ["not-a-real-capability"] }] }), /unknown capability/);
  assert.throws(() => sanitizeCustomRolesConfig({ customRoles: [{ id: "r", label: "R", baseRole: "viewer", permissionSetIds: ["missing"] }] }), /unknown permission set/);
});

test("a custom role can't be grounded in guest", () => {
  assert.throws(() => sanitizeCustomRolesConfig({ customRoles: [{ id: "r", label: "R", baseRole: "guest" }] }), CustomRolesError);
});

test("resolution helpers: claims → custom roles → capabilities", () => {
  const c = sanitizeCustomRolesConfig(GOOD);
  const roles = customRolesForClaims(["FINANCE"], c);
  assert.equal(roles.length, 1);
  assert.equal(roles[0]!.id, "finance-analyst");
  assert.deepEqual(capabilitiesForCustomRoles(["finance-analyst"], c), [CAP]);
  // A claim matching nothing resolves to no roles.
  assert.deepEqual(customRolesForClaims(["engineering"], c), []);
  // claims → granted capabilities (what the capability gate consults).
  assert.deepEqual(capabilitiesForClaims(["finance"], c), [CAP]);
  assert.deepEqual(capabilitiesForClaims(["engineering"], c), []);
});
