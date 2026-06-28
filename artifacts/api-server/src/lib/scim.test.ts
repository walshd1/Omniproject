import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createUser, getUser, patchUser, replaceUser, deleteUser, listUsers,
  createGroup, patchGroup, directoryDecision, scimTokenValid, __resetScim,
} from "./scim";

/**
 * SCIM directory: lifecycle overlay over OIDC. Deprovision (active=false) denies; group
 * membership becomes role claims.
 */
beforeEach(() => { process.env["SCIM_TOKEN"] = "scim-secret"; __resetScim(); });
afterEach(() => { delete process.env["SCIM_TOKEN"]; __resetScim(); });

test("scimTokenValid is a constant-time exact match", () => {
  assert.equal(scimTokenValid("scim-secret"), true);
  assert.equal(scimTokenValid("wrong"), false);
  assert.equal(scimTokenValid(undefined), false);
});

test("a created user round-trips and lists by userName filter", () => {
  const u = createUser({ userName: "alice@corp.com", emails: [{ value: "alice@corp.com", primary: true }] });
  assert.equal(getUser(u.id)?.userName, "alice@corp.com");
  const found = listUsers('userName eq "alice@corp.com"');
  assert.equal(found.length, 1);
  assert.equal(found[0]!.id, u.id);
});

test("PATCH active=false deprovisions; the directory decision denies", () => {
  const u = createUser({ userName: "bob@corp.com" });
  assert.equal(directoryDecision({ email: "bob@corp.com" }).active, true);
  patchUser(u.id, [{ op: "replace", path: "active", value: false }]);
  const d = directoryDecision({ email: "bob@corp.com" });
  assert.equal(d.known, true);
  assert.equal(d.active, false);
});

test("group membership becomes role claims in the directory decision", () => {
  const u = createUser({ userName: "carol@corp.com", externalId: "oidc-sub-carol" });
  createGroup({ displayName: "omni-admins", members: [{ value: u.id }] });
  const d = directoryDecision({ sub: "oidc-sub-carol" });
  assert.equal(d.known, true);
  assert.deepEqual(d.roleClaims, ["omni-admins"]);
});

test("removing a member via group PATCH drops the role claim", () => {
  const u = createUser({ userName: "dave@corp.com" });
  const g = createGroup({ displayName: "pmo", members: [{ value: u.id }] });
  assert.deepEqual(directoryDecision({ email: "dave@corp.com" }).roleClaims, ["pmo"]);
  patchGroup(g.id, [{ op: "remove", path: "members", value: [{ value: u.id }] }]);
  assert.deepEqual(directoryDecision({ email: "dave@corp.com" }).roleClaims, []);
});

test("an unknown user yields no opinion (fall back to pure OIDC)", () => {
  const d = directoryDecision({ email: "stranger@corp.com" });
  assert.equal(d.known, false);
  assert.equal(d.active, true);
});

test("PUT replaces a user; DELETE removes them", () => {
  const u = createUser({ userName: "erin@corp.com" });
  replaceUser(u.id, { userName: "erin@corp.com", active: false });
  assert.equal(getUser(u.id)?.active, false);
  assert.equal(deleteUser(u.id), true);
  assert.equal(getUser(u.id), null);
});

test("SCIM is disabled (no opinion) when SCIM_TOKEN is unset", () => {
  delete process.env["SCIM_TOKEN"];
  createUser({ userName: "frank@corp.com", active: false });
  // With SCIM off, the directory expresses no opinion even for a stored inactive user.
  assert.deepEqual(directoryDecision({ email: "frank@corp.com" }), { known: false, active: true, roleClaims: [] });
});
