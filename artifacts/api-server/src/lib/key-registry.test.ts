import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { currentVersion, isActive, derivedKey, revokeKey, listKeys, revokeUserSessions, userSessionsRevokedAt, __resetKeyRegistry } from "./key-registry";
import { record, recentProvenance, verifyChain, __resetProvenance } from "./provenance";

/**
 * Key registry + revocation: revoking retires a version (rejected) and rolls to a fresh
 * derived key; provenance entries under a revoked version still verify but are flagged.
 */
beforeEach(() => { __resetKeyRegistry(); __resetProvenance(); });

test("keys start at version 1, active, and derive distinct material per version", () => {
  assert.equal(currentVersion("session"), 1);
  assert.equal(isActive("session", 1), true);
  assert.notEqual(derivedKey("session", 1), derivedKey("session", 2));
  assert.notEqual(derivedKey("session", 1), derivedKey("provenance", 1)); // per-name
});

test("revoking retires the current version and rolls forward", () => {
  const status = revokeKey("session", { by: "admin-1", reason: "suspected compromise" });
  assert.equal(status.version, 2);
  assert.deepEqual(status.revokedVersions, [1]);
  assert.equal(isActive("session", 1), false); // retired
  assert.equal(isActive("session", 2), true); // fresh
  assert.equal(currentVersion("session"), 2);
  assert.equal(listKeys().find((k) => k.name === "session")!.lastActor, "admin-1");
});

test("per-user session revocation records the cut-off instant", () => {
  assert.equal(userSessionsRevokedAt("u1"), 0);
  revokeUserSessions("u1");
  assert.ok(userSessionsRevokedAt("u1") > 0);
});

test("revoking the provenance key: new entries verify, old ones are flagged revoked", () => {
  record({ callId: "c1", hop: "invoke", action: "a", actor: "u1", content: [1] }); // kver 1
  revokeKey("provenance", {});
  record({ callId: "c2", hop: "invoke", action: "b", actor: "u1", content: [2] }); // kver 2
  const entries = recentProvenance();
  assert.equal(entries[0]!.kver, 1);
  assert.equal(entries[1]!.kver, 2);
  const v = verifyChain(entries);
  assert.equal(v.ok, true); // integrity still checks (material re-derived per version)
  assert.deepEqual(v.revokedKeyVersions, [1]); // ...but the old key is untrusted
});
