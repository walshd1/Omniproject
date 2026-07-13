import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createUser, getUser, patchUser, replaceUser, deleteUser, listUsers,
  createGroup, patchGroup, directoryDecision, scimTokenValid,
  refreshScimFromShared, SCIM_SHARED_KEY, __resetScim,
} from "./scim";
import { sharedKv, __resetSharedStateForTest } from "./shared-state";

/**
 * SCIM directory: lifecycle overlay over OIDC. Deprovision (active=false) denies; group
 * membership becomes role claims.
 */
beforeEach(() => { process.env["SCIM_TOKEN"] = "scim-secret"; __resetScim(); __resetSharedStateForTest(); });
afterEach(() => { delete process.env["SCIM_TOKEN"]; __resetScim(); __resetSharedStateForTest(); });

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

test("fleet propagation: a deprovision on one replica denies the user on a sibling after refresh", async () => {
  // Replica A provisions then deprovisions bob — both write through to shared state.
  const u = createUser({ userName: "bob@corp.com", active: true });
  patchUser(u.id, [{ op: "replace", path: "active", value: false }]);
  await refreshScimFromShared(); // flush the best-effort write-through deterministically
  assert.equal(directoryDecision({ email: "bob@corp.com" }).active, false);

  // Replica B starts from a clean local directory over the same shared state.
  __resetScim();
  assert.equal(directoryDecision({ email: "bob@corp.com" }).known, false); // B hasn't seen bob yet
  await refreshScimFromShared();
  const d = directoryDecision({ email: "bob@corp.com" });
  assert.equal(d.known, true);
  assert.equal(d.active, false); // ...now B denies the deprovisioned user too
});

test("fleet merge is last-writer-wins — a later reactivation beats an older deprovision", async () => {
  const u = createUser({ userName: "carol@corp.com", active: true });
  await refreshScimFromShared();

  // A stale sibling snapshot in shared state still marks carol INACTIVE with an OLDER lastModified.
  const shared = JSON.parse((await sharedKv.get(SCIM_SHARED_KEY))!);
  shared.users[u.id] = { ...shared.users[u.id], active: false, meta: { ...shared.users[u.id].meta, lastModified: "2000-01-01T00:00:00.000Z" } };
  await sharedKv.set(SCIM_SHARED_KEY, JSON.stringify(shared));

  // Merge must keep the NEWER local record (active=true) — LWW, not "most restrictive".
  await refreshScimFromShared();
  assert.equal(directoryDecision({ email: "carol@corp.com" }).active, true);
});

test("fleet merge: a tombstoned delete is not resurrected by a sibling's stale copy", async () => {
  const u = createUser({ userName: "dave@corp.com" });
  await refreshScimFromShared();
  const withDave = await sharedKv.get(SCIM_SHARED_KEY); // shared copy that still HAS dave

  deleteUser(u.id); // tombstones dave locally + in shared
  await refreshScimFromShared();
  assert.equal(getUser(u.id), null);

  // A lagging sibling re-publishes its stale snapshot (dave present, no tombstone).
  const stale = JSON.parse(withDave!);
  const cur = JSON.parse((await sharedKv.get(SCIM_SHARED_KEY))!);
  await sharedKv.set(SCIM_SHARED_KEY, JSON.stringify({ ...stale, tombstones: cur.tombstones }));
  await refreshScimFromShared();
  assert.equal(getUser(u.id), null); // the tombstone out-dates the stale record ⇒ stays deleted
});

test("a forbidden prototype key as the SCIM id is never treated as a resource (no pollution)", () => {
  for (const bad of ["__proto__", "constructor", "prototype"]) {
    // Reads resolve to "not found", not the phantom Object.prototype / Object constructor.
    assert.equal(getUser(bad), null, `getUser(${bad})`);
    assert.equal(patchUser(bad, [{ op: "replace", path: "active", value: false }]), null, `patchUser(${bad})`);
    assert.equal(replaceUser(bad, { active: false }), null, `replaceUser(${bad})`);
    assert.equal(deleteUser(bad), false, `deleteUser(${bad})`);
  }
  // The PUT-that-would-pollute is refused, so the directory map's prototype is intact.
  replaceUser("__proto__", { userName: "polluted", active: true });
  const victim: Record<string, unknown> = {};
  assert.equal(victim["userName"], undefined, "Object.prototype was not polluted");
  // A normal user still works after the attempted attack.
  const u = createUser({ userName: "real@corp.com" });
  assert.equal(getUser(u.id)?.userName, "real@corp.com");
});
