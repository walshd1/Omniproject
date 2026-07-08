import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { currentVersion, isActive, derivedKey, revokeKey, listKeys, revokeUserSessions, userSessionsRevokedAt, snapshotKeys, restoreKeys, __resetKeyRegistry } from "./key-registry";
import { record, recentProvenance, verifyChain, __resetProvenance } from "./provenance";

/**
 * Key registry + revocation: revoking retires a version (rejected) and rolls to a fresh
 * derived key; provenance entries under a revoked version still verify but are flagged.
 */
const ENV = ["SESSION_SECRET", "PROVENANCE_KEY", "BROKER_PSK", "AUDIT_KEY"];
beforeEach(() => { __resetKeyRegistry(); __resetProvenance(); });
afterEach(() => { for (const k of ENV) delete process.env[k]; __resetKeyRegistry(); });

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

test("master key derivation uses the per-name env secret, then a fallback chain", () => {
  process.env["SESSION_SECRET"] = "sess";
  process.env["PROVENANCE_KEY"] = "prov";
  process.env["BROKER_PSK"] = "brok";
  process.env["AUDIT_KEY"] = "aud";
  // Each name derives distinct material because each resolves a distinct per-name master.
  const keys = ["session", "provenance", "broker", "audit"].map((n) => derivedKey(n, 1));
  assert.equal(new Set(keys).size, 4);

  // With only PROVENANCE_KEY set, a name whose own secret is absent falls back to it.
  for (const k of ENV) delete process.env[k];
  process.env["PROVENANCE_KEY"] = "only-prov";
  const before = derivedKey("session", 1);
  process.env["PROVENANCE_KEY"] = "changed-prov";
  assert.notEqual(derivedKey("session", 1), before, "session falls back to PROVENANCE_KEY");
});

test("snapshotKeys/restoreKeys round-trips revocation state", () => {
  revokeKey("session", { by: "admin", reason: "leak" });
  revokeUserSessions("u1");
  const snap = snapshotKeys();
  assert.equal(snap.keys["session"]!.version, 2);
  assert.deepEqual(snap.keys["session"]!.revoked, [1]);
  assert.ok(snap.userRevokedAt["u1"]! > 0);

  __resetKeyRegistry();
  assert.equal(currentVersion("session"), 1); // reset
  restoreKeys(snap);
  assert.equal(currentVersion("session"), 2);
  assert.equal(isActive("session", 1), false);
  assert.ok(userSessionsRevokedAt("u1") > 0);
});

test("restoreKeys tolerates a snapshot with missing/partial fields", () => {
  restoreKeys({ keys: { broker: { version: 3 } as never }, userRevokedAt: {} });
  assert.equal(currentVersion("broker"), 3);
  const status = listKeys().find((k) => k.name === "broker")!;
  assert.deepEqual(status.revokedVersions, []); // defaulted from a missing `revoked`
  assert.equal(status.rotatedAt, null);
  assert.equal(status.lastActor, null);

  // An entirely empty snapshot is a no-op, not a throw.
  restoreKeys({ keys: {}, userRevokedAt: {} } as never);
  restoreKeys({} as never);
});
