import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerSession, activeSessionCount, maxSessionsPerUser, issueSequence, checkSequence, sequenceEnforced, __resetSessionRegistry } from "./session-registry";

afterEach(() => {
  delete process.env["MAX_SESSIONS_PER_USER"];
  delete process.env["SESSION_SEQUENCE_ENFORCE"];
  delete process.env["SESSION_SEQUENCE_GRACE"];
  __resetSessionRegistry();
});

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

// ── Rotating-token sequence (replay / reuse detection) ───────────────────────────────────────────

test("sequence enforcement is ON by default; disable-able", () => {
  assert.equal(sequenceEnforced(), true);
  process.env["SESSION_SEQUENCE_ENFORCE"] = "0";
  assert.equal(sequenceEnforced(), false);
});

test("in-order use is fine; each re-seal advances the mark", () => {
  const s = "salt-a";
  assert.equal(issueSequence(s, 1000), 1); // login
  assert.equal(checkSequence(s, 1, 1001), "ok");
  assert.equal(issueSequence(s, 2000), 2); // re-seal
  assert.equal(checkSequence(s, 2, 2001), "ok");
  assert.equal(checkSequence(s, 2, 2002), "ok"); // parallel requests share the same seq
});

test("a cookie one step behind the mark is tolerated (concurrency grace)", () => {
  const s = "salt-b";
  issueSequence(s, 1000); // seq 1
  issueSequence(s, 2000); // seq 2 (mark is now 2)
  // A still-in-flight request carrying the just-superseded seq 1 is within grace → accepted.
  assert.equal(checkSequence(s, 1, 2001), "ok");
});

test("a cookie WELL behind the mark is a fork → the session is killed for everyone", () => {
  process.env["SESSION_SEQUENCE_GRACE"] = "1";
  const s = "salt-c";
  for (let i = 1; i <= 6; i++) issueSequence(s, 1000 + i); // mark advances to 6
  // A replay of an old captured cookie (seq 2, well behind 6, grace 1) → fork.
  assert.equal(checkSequence(s, 2, 3000), "fork");
  // Reuse burns the family: even the CURRENT holder (seq 6) is now rejected → both must re-auth.
  assert.equal(checkSequence(s, 6, 3001), "fork");
});

test("first sight grandfathers a pre-sequencing cookie (seq 0) without killing it", () => {
  const s = "salt-d";
  // A session minted before sequencing has no seq (treated as 0) — first sight must be accepted.
  assert.equal(checkSequence(s, 0, 1000), "ok");
  assert.equal(checkSequence(s, 0, 1001), "ok");
  // It then migrates: the next re-seal issues seq 1.
  assert.equal(issueSequence(s, 2000), 1);
  assert.equal(checkSequence(s, 1, 2001), "ok");
});

test("disabled ⇒ every sequence check is a no-op ok (never kills)", () => {
  process.env["SESSION_SEQUENCE_ENFORCE"] = "0";
  const s = "salt-e";
  for (let i = 1; i <= 10; i++) issueSequence(s, 1000 + i);
  assert.equal(checkSequence(s, 1, 3000), "ok"); // would be a fork if enforced
});
