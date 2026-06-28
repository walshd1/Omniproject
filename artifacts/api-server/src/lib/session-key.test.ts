import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { deriveSessionBrokerKey, sessionBindFromSession } from "./session-key";
import { derivedKey, revokeKey, __resetKeyRegistry } from "./key-registry";

/**
 * The per-session broker key derives deterministically from (master ‖ user ‖ session
 * start ‖ salt), differs across users/sessions, and is NOT the static broker key.
 */
afterEach(() => __resetKeyRegistry());

const bind = { sub: "alice", smono: "12345", salt: "deadbeef" };

test("derivation is deterministic for the same binding", () => {
  assert.equal(deriveSessionBrokerKey(bind), deriveSessionBrokerKey(bind));
});

test("the session key is NOT the static broker key (it is bound)", () => {
  assert.notEqual(deriveSessionBrokerKey(bind), derivedKey("broker"));
});

test("a different user, session start, or salt yields a different key", () => {
  const base = deriveSessionBrokerKey(bind);
  assert.notEqual(base, deriveSessionBrokerKey({ ...bind, sub: "bob" }));
  assert.notEqual(base, deriveSessionBrokerKey({ ...bind, smono: "99999" }));
  assert.notEqual(base, deriveSessionBrokerKey({ ...bind, salt: "cafe" }));
});

test("revoking the broker key rolls the derived session key forward", () => {
  const before = deriveSessionBrokerKey(bind); // bkver defaults to current (v1)
  revokeKey("broker", { by: "admin", reason: "rotation" });
  const after = deriveSessionBrokerKey(bind); // now defaults to v2
  assert.notEqual(before, after);
  // …but pinning the old version still re-derives the old key (to verify historical traffic).
  assert.equal(before, deriveSessionBrokerKey({ ...bind, bkver: 1 }));
});

test("sessionBindFromSession needs sub + smono + salt, else null (fallback to static key)", () => {
  assert.deepEqual(sessionBindFromSession({ sub: "alice", smono: "1", salt: "x" }), { sub: "alice", smono: "1", salt: "x" });
  assert.equal(sessionBindFromSession({ sub: "alice", smono: "1" }), null); // no salt
  assert.equal(sessionBindFromSession({ sub: "alice", salt: "x" }), null); // no smono
  assert.equal(sessionBindFromSession(null), null);
});
