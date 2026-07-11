import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createUser, patchUser, replaceUser, deleteUser, listUsers,
  createGroup, getGroup, replaceGroup, patchGroup, deleteGroup, listGroups,
  directoryDecision, scimStats, scimEnabled, __resetScim,
} from "./scim";

/**
 * SCIM directory — additional branch coverage for the user/group PATCH/PUT operations, the
 * filter parser, and the request-time directory decision (match by userName/email/externalId).
 */
beforeEach(() => { process.env["SCIM_TOKEN"] = "scim-secret"; __resetScim(); });
afterEach(() => { delete process.env["SCIM_TOKEN"]; __resetScim(); });

test("replaceUser returns null for an unknown id and keeps unspecified fields", () => {
  assert.equal(replaceUser("nope", { userName: "x" }), null);
  const u = createUser({ userName: "alice", displayName: "Alice", externalId: "ext-1", emails: [{ value: "a@x.com" }] });
  // A partial replace keeps existing values via the `?? existing` fallbacks.
  const kept = replaceUser(u.id, {})!;
  assert.equal(kept.userName, "alice");
  assert.equal(kept.displayName, "Alice");
  assert.equal(kept.externalId, "ext-1");
  // A full replace overrides them.
  const full = replaceUser(u.id, { userName: "alice2", displayName: "Alice2", externalId: "ext-2", active: false, emails: [{ value: "b@x.com" }], groups: [] })!;
  assert.equal(full.userName, "alice2");
  assert.equal(full.active, false);
});

test("patchUser: unknown id → null; active/displayName/userName ops; non-add/replace op ignored", () => {
  assert.equal(patchUser("nope", []), null);
  const u = createUser({ userName: "bob" });

  // active via a value object with no path (Okta shape).
  patchUser(u.id, [{ op: "Add", value: { active: false } }]);
  assert.equal(directoryDecision({ userName: "bob" }).active, false);

  // active=true via an explicit path + string "true".
  patchUser(u.id, [{ op: "replace", path: "active", value: "true" }]);
  assert.equal(directoryDecision({ userName: "bob" }).active, true);

  // displayName + userName replacements.
  const after = patchUser(u.id, [{ op: "replace", path: "displayName", value: "Bobby" }, { op: "replace", path: "userName", value: "bobby" }])!;
  assert.equal(after.displayName, "Bobby");
  assert.equal(after.userName, "bobby");

  // An unsupported op is a no-op (not an error).
  const unchanged = patchUser(u.id, [{ op: "remove", path: "displayName" }])!;
  assert.equal(unchanged.displayName, "Bobby");
});

test("deleteUser returns false for an unknown id", () => {
  assert.equal(deleteUser("ghost"), false);
  const u = createUser({ userName: "temp" });
  assert.equal(deleteUser(u.id), true);
});

test("listUsers filters by externalId and by email value", () => {
  createUser({ userName: "carol", externalId: "EXT-9", emails: [{ value: "carol@corp.com" }] });
  assert.equal(listUsers('externalId eq "ext-9"').length, 1); // case-insensitive
  assert.equal(listUsers('emails.value eq "carol@corp.com"').length, 1);
  assert.equal(listUsers('emails eq "carol@corp.com"').length, 1);
  assert.equal(listUsers('unknownAttr eq "x"').length, 0); // unsupported attr → no match
  assert.equal(listUsers("not a valid filter").length, 1); // unparseable → returns all
});

test("group create/get/replace/patch/delete membership drives user role claims", () => {
  const u = createUser({ userName: "dan" });
  const g = createGroup({ displayName: "Engineers", members: [{ value: u.id }] });
  assert.equal(getGroup(g.id)!.displayName, "Engineers");
  assert.deepEqual(directoryDecision({ userName: "dan" }).roleClaims, ["Engineers"]);

  // replaceGroup with new members + name.
  const u2 = createUser({ userName: "erin" });
  const replaced = replaceGroup(g.id, { displayName: "Eng", members: [{ value: u2.id }] })!;
  assert.equal(replaced.displayName, "Eng");
  assert.deepEqual(directoryDecision({ userName: "dan" }).roleClaims, []); // dan dropped
  assert.deepEqual(directoryDecision({ userName: "erin" }).roleClaims, ["Eng"]);

  // patchGroup add / remove / replace member ops + displayName op.
  patchGroup(g.id, [{ op: "add", path: "members", value: [{ value: u.id }] }]);
  assert.deepEqual(directoryDecision({ userName: "dan" }).roleClaims, ["Eng"]);
  patchGroup(g.id, [{ op: "remove", path: "members", value: [{ value: u2.id }] }]);
  assert.deepEqual(directoryDecision({ userName: "erin" }).roleClaims, []);
  patchGroup(g.id, [{ op: "replace", path: "members", value: [{ value: u2.id }] }]);
  assert.deepEqual(directoryDecision({ userName: "dan" }).roleClaims, []);
  const renamed = patchGroup(g.id, [{ op: "replace", path: "displayName", value: "Engineering" }])!;
  assert.equal(renamed.displayName, "Engineering");

  assert.equal(deleteGroup(g.id), true);
  assert.equal(deleteGroup("ghost"), false);
});

test("replaceGroup / patchGroup return null for an unknown id", () => {
  assert.equal(replaceGroup("nope", {}), null);
  assert.equal(patchGroup("nope", []), null);
});

test("listGroups filters by displayName; a non-displayName attr matches nothing", () => {
  createGroup({ displayName: "Admins" });
  assert.equal(listGroups('displayName eq "admins"').length, 1);
  assert.equal(listGroups('externalId eq "x"').length, 0);
  assert.equal(listGroups().length, 1); // no filter → all
});

test("directoryDecision matches by email and by externalId (sub); unknown → no opinion", () => {
  createUser({ userName: "frank", externalId: "sub-123", emails: [{ value: "frank@corp.com" }] });
  assert.equal(directoryDecision({ email: "frank@corp.com" }).known, true);
  assert.equal(directoryDecision({ sub: "sub-123" }).known, true);
  assert.equal(directoryDecision({ userName: "nobody" }).known, false);
});

test("scimStats + scimEnabled reflect the token and directory size", () => {
  createUser({ userName: "gary" });
  createGroup({ displayName: "G" });
  const stats = scimStats();
  assert.equal(stats.enabled, true);
  assert.equal(stats.users, 1);
  assert.equal(stats.groups, 1);
  assert.equal(scimEnabled(), true);
});
