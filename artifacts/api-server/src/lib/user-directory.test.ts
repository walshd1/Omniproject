import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env["SESSION_SECRET"] = "test-session-secret-do-not-use";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "user-dir-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

const dir = await import("./user-directory");

const now = "2026-07-19T00:00:00.000Z";
after(() => fs.rmSync(CONFIG_DIR, { recursive: true, force: true }));
afterEach(() => { for (const u of dir.listUsers()) dir.deleteUser(u.id); });

test("create → list → get; userName is unique (case-insensitive)", () => {
  const u = dir.createUser({ userName: "Alice", email: "a@x.io", groups: ["omni-admins"] }, "tester", now);
  assert.match(u.id, /^local:/);
  assert.equal(u.userName, "Alice");
  assert.equal(u.hasPassword, false);
  assert.equal(dir.listUsers().length, 1);
  assert.throws(() => dir.createUser({ userName: "alice" }, "tester", now), /already taken/);
});

test("localUsersActive flips on with an active user, off when all inactive", () => {
  assert.equal(dir.localUsersActive(), false);
  const u = dir.createUser({ userName: "bob", groups: [] }, "t", now);
  assert.equal(dir.localUsersActive(), true);
  dir.updateUser(u.id, { active: false }, now);
  assert.equal(dir.localUsersActive(), false, "an inactive user doesn't count");
  assert.equal(dir.anyUserExists(), true, "…but the record still exists");
});

test("update patches groups/active; getActiveUserByUserName ignores inactive", () => {
  const u = dir.createUser({ userName: "carol", groups: ["viewers"] }, "t", now);
  dir.updateUser(u.id, { groups: ["omni-admins", "pmo"] }, now);
  assert.deepEqual(dir.getUser(u.id)!.groups, ["omni-admins", "pmo"]);
  assert.ok(dir.getActiveUserByUserName("carol"));
  dir.updateUser(u.id, { active: false }, now);
  assert.equal(dir.getActiveUserByUserName("carol"), null);
});

test("invalid email is rejected on create and update", () => {
  assert.throws(() => dir.createUser({ userName: "dan", email: "not-an-email" }, "t", now), /valid address/);
});

test("localAdminRequiresPasskey defaults OFF, honours the env flag", () => {
  delete process.env["LOCAL_ADMIN_REQUIRE_PASSKEY"];
  assert.equal(dir.localAdminRequiresPasskey(), false);
  process.env["LOCAL_ADMIN_REQUIRE_PASSKEY"] = "true";
  assert.equal(dir.localAdminRequiresPasskey(), true);
  process.env["LOCAL_ADMIN_REQUIRE_PASSKEY"] = "false";
  assert.equal(dir.localAdminRequiresPasskey(), false);
  delete process.env["LOCAL_ADMIN_REQUIRE_PASSKEY"];
});
