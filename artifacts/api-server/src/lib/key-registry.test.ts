import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { currentVersion, isActive, derivedKey, revokeKey, listKeys, revokeUserSessions, userSessionsRevokedAt, snapshotKeys, restoreKeys, refreshKeyRegistryFromShared, sanitizeSharedSnapshot, KEY_REGISTRY_SHARED_KEY, __resetKeyRegistry } from "./key-registry";
import { sharedKv, __resetSharedStateForTest } from "./shared-state";
import { record, recentProvenance, verifyChain, __resetProvenance } from "./provenance";

/**
 * Key registry + revocation: revoking retires a version (rejected) and rolls to a fresh
 * derived key; provenance entries under a revoked version still verify but are flagged.
 */
const ENV = ["SESSION_SECRET", "PROVENANCE_KEY", "BROKER_PSK", "AUDIT_KEY"];
beforeEach(() => { __resetKeyRegistry(); __resetProvenance(); __resetSharedStateForTest(); });
afterEach(() => { for (const k of ENV) delete process.env[k]; __resetKeyRegistry(); __resetSharedStateForTest(); });

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

test("fleet propagation: a revocation on one replica is unioned into a sibling on refresh", async () => {
  // Replica A revokes a key + a user's sessions — both write through to shared state.
  revokeKey("session", { by: "admin", reason: "leak" });
  revokeUserSessions("u1");
  await refreshKeyRegistryFromShared(); // flush the best-effort write-through deterministically
  const shared = JSON.parse((await sharedKv.get(KEY_REGISTRY_SHARED_KEY))!) as ReturnType<typeof snapshotKeys>;
  assert.deepEqual(shared.keys["session"]!.revoked, [1]);
  assert.ok(shared.userRevokedAt["u1"]! > 0);

  // Replica B starts from a clean local view over the same shared state and converges.
  __resetKeyRegistry();
  assert.equal(isActive("session", 1), true); // B hasn't seen the revocation yet
  await refreshKeyRegistryFromShared();
  assert.equal(isActive("session", 1), false); // ...now it has
  assert.equal(currentVersion("session"), 2);
  assert.ok(userSessionsRevokedAt("u1") > 0);
});

test("fleet merge is monotonic union — a stale shared snapshot can never un-revoke a local key", async () => {
  // Local holds a revocation that shared state is missing (e.g. restored from this replica's sealed
  // file, or a racing sibling clobbered shared). A refresh must KEEP it and push it back, not drop it.
  revokeKey("broker", {});
  await sharedKv.set(KEY_REGISTRY_SHARED_KEY, JSON.stringify({ keys: {}, userRevokedAt: {} })); // stale/empty
  await refreshKeyRegistryFromShared();
  assert.equal(isActive("broker", 1), false); // still revoked locally
  const shared = JSON.parse((await sharedKv.get(KEY_REGISTRY_SHARED_KEY))!) as ReturnType<typeof snapshotKeys>;
  assert.deepEqual(shared.keys["broker"]!.revoked, [1]); // ...and anti-entropy pushed it back to shared
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

test("sanitizeSharedSnapshot clamps a far-future lockout, drops proto keys, unknown key names + bad versions", () => {
  const now = 1_700_000_000_000;
  const hostile = JSON.stringify({
    keys: {
      session: { version: 3, revoked: [1, 2, "x"], rotatedAt: null, lastActor: null, lastReason: null },
      bogus: { version: 5, revoked: [] },          // not a known key name → dropped
      audit: { version: -1 },                         // invalid version → dropped
    },
    userRevokedAt: {
      "u-real": now - 1000,                           // legit past instant → kept
      "u-attack": now + 10 * 365 * 24 * 3600_000,     // 10y in the future → clamped (no permanent lockout)
      "__proto__": now,                               // prototype-pollution sub → dropped
    },
  });
  const clean = sanitizeSharedSnapshot(hostile, now);
  assert.deepEqual(Object.keys(clean.keys).sort(), ["session"]); // bogus + invalid-version dropped
  assert.deepEqual(clean.keys["session"]!.revoked, [1, 2]);      // non-number filtered out
  assert.equal(clean.userRevokedAt["u-real"], now - 1000);
  assert.ok(clean.userRevokedAt["u-attack"]! <= now + 5 * 60_000, "far-future revoke instant is clamped");
  assert.equal("polluted" in ({} as Record<string, unknown>), false);
});
