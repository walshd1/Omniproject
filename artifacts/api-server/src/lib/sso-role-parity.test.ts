import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { grantsFromClaims, type Grants } from "./rbac";
import { profileToClaims } from "./saml";
import { createUser, createGroup, directoryDecision, __resetScim } from "./scim";

/**
 * SSO role-mapping PARITY: an IdP group must resolve to the SAME OmniProject grants no matter
 * which protocol delivered it — an OIDC role claim, a SAML assertion group attribute, or a SCIM
 * group membership. All three funnel through the one pure resolver (`grantsFromClaims`) against
 * the one operator-configured role map, so a "group → role" decision is made ONCE and honoured
 * identically everywhere. This test pins that contract so a future change to any single path
 * can't silently drift from the others.
 */

// One role map, configured once for every protocol. rbac reads these live per call.
process.env["OIDC_ADMIN_ROLES"] = "omni-admins";
process.env["OIDC_PMO_ROLES"] = "programme-managers";
process.env["OIDC_MANAGER_ROLES"] = "delivery-leads";

const samlCfg = {
  entryPoint: "", idpCert: "", issuer: "", callbackUrl: "", audience: "",
  emailAttr: "email", nameAttr: "displayName", groupsAttr: "groups", wantResponseSigned: false,
};

/** A comparable, order-independent shape of a user's grants. */
function shape(g: Grants): { base: string; authorities: string[] } {
  return { base: g.base, authorities: [...g.authorities].sort() };
}

beforeEach(() => { process.env["SCIM_TOKEN"] = "scim-secret-strong-012345"; __resetScim(); });
afterEach(() => { delete process.env["SCIM_TOKEN"]; __resetScim(); });

for (const group of ["omni-admins", "programme-managers", "delivery-leads", "unmapped-group"]) {
  test(`"${group}" resolves to identical grants via OIDC, SAML, and SCIM`, () => {
    // OIDC: the role claim arrives directly on the session.
    const viaOidc = grantsFromClaims([group], { isDemo: false });

    // SAML: the assertion's group attribute → claims → the same resolver.
    const samlClaims = profileToClaims({ nameID: "u1", attributes: { groups: group } }, samlCfg);
    const viaSaml = grantsFromClaims(samlClaims.roles, { isDemo: false });

    // SCIM: a group membership becomes a role claim in the directory decision → same resolver.
    const u = createUser({ userName: "u1@corp.com" });
    createGroup({ displayName: group, members: [{ value: u.id }] });
    const decision = directoryDecision({ email: "u1@corp.com" });
    const viaScim = grantsFromClaims(decision.roleClaims, { isDemo: false });

    assert.deepEqual(shape(viaSaml), shape(viaOidc), "SAML path must match OIDC");
    assert.deepEqual(shape(viaScim), shape(viaOidc), "SCIM path must match OIDC");
  });
}

test("the mapped groups actually confer their expected authority (guards a vacuous parity)", () => {
  assert.deepEqual(shape(grantsFromClaims(["omni-admins"], { isDemo: false })), { base: "manager", authorities: ["admin"] });
  assert.deepEqual(shape(grantsFromClaims(["programme-managers"], { isDemo: false })), { base: "manager", authorities: ["pmo"] });
  assert.deepEqual(shape(grantsFromClaims(["delivery-leads"], { isDemo: false })), { base: "manager", authorities: [] });
});
