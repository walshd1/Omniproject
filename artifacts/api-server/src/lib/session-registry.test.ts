import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerSession, activeSessionCount, maxSessionsPerUser, __resetSessionRegistry } from "./session-registry";

afterEach(() => { delete process.env["MAX_SESSIONS_PER_USER"]; __resetSessionRegistry(); });

test("unset cap is a no-op (every session allowed)", () => {
  assert.equal(maxSessionsPerUser(), 0);
  for (let i = 0; i < 5; i++) assert.equal(registerSession("u1", `sid-${i}`, 1000 + i), true);
});

test("newest logins win: an older session beyond the cap is denied", () => {
  process.env["MAX_SESSIONS_PER_USER"] = "2";
  assert.equal(registerSession("u1", "a", 1000), true);
  assert.equal(registerSession("u1", "b", 2000), true);
  // Third concurrent login evicts the oldest (a); b + c remain.
  assert.equal(registerSession("u1", "c", 3000), true);
  assert.equal(registerSession("u1", "a", 4000), false); // a is now outside the cap
  assert.equal(registerSession("u1", "b", 4000), true);
  assert.equal(registerSession("u1", "c", 4000), true);
});

test("re-validating the same session keeps it allowed (idempotent)", () => {
  process.env["MAX_SESSIONS_PER_USER"] = "1";
  assert.equal(registerSession("u1", "only", 1000), true);
  assert.equal(registerSession("u1", "only", 1100), true);
  assert.equal(registerSession("u1", "only", 1200), true);
  assert.equal(activeSessionCount("u1"), 1);
});

test("a second user is independent", () => {
  process.env["MAX_SESSIONS_PER_USER"] = "1";
  assert.equal(registerSession("u1", "a", 1000), true);
  assert.equal(registerSession("u2", "b", 1000), true); // different user, own slot
});

test("sessions past the absolute window are pruned", () => {
  process.env["MAX_SESSIONS_PER_USER"] = "2";
  process.env["SESSION_ABSOLUTE_HOURS"] = "1";
  registerSession("u1", "old", 0);
  // 2h later, the old session is pruned and a new one is allowed even at the cap.
  const later = 2 * 3_600_000;
  assert.equal(registerSession("u1", "new1", later), true);
  assert.equal(registerSession("u1", "new2", later), true);
  assert.equal(activeSessionCount("u1"), 2); // "old" pruned
  delete process.env["SESSION_ABSOLUTE_HOURS"];
});
