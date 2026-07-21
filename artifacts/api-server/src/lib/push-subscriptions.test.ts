import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod"; // lets sealConfig derive a key

/** Per-user push subscriptions: sanitize (endpoint allow-list + key bounds) and the sealed per-user round-trip. */

let store: typeof import("./push-subscriptions");
const FCM = "https://fcm.googleapis.com/fcm/send/device-a";
const FCM2 = "https://fcm.googleapis.com/fcm/send/device-b";
const keys = { p256dh: "BExamplePublicKey", auth: "authSecret" };

before(async () => { store = await import("./push-subscriptions"); });
beforeEach(() => { process.env["OMNI_CONFIG_DIR"] = fs.mkdtempSync(path.join(os.tmpdir(), "push-subs-")); });
after(() => { delete process.env["OMNI_CONFIG_DIR"]; });

test("sanitizeSubscription accepts an allowed endpoint with keys, rejects the rest", () => {
  assert.deepEqual(store.sanitizeSubscription({ endpoint: FCM, keys }), { endpoint: FCM, keys });
  // A browser PushSubscription serialises extra fields; we keep only endpoint + keys.
  assert.deepEqual(store.sanitizeSubscription({ endpoint: FCM, keys, expirationTime: null, junk: 1 }), { endpoint: FCM, keys });
  assert.equal(store.sanitizeSubscription(null), null);
  assert.equal(store.sanitizeSubscription({ endpoint: "https://evil.example/x", keys }), null, "disallowed host");
  assert.equal(store.sanitizeSubscription({ endpoint: "http://fcm.googleapis.com/x", keys }), null, "non-https");
  assert.equal(store.sanitizeSubscription({ endpoint: FCM }), null, "missing keys");
  assert.equal(store.sanitizeSubscription({ endpoint: FCM, keys: { p256dh: "p" } }), null, "missing auth");
  assert.equal(store.sanitizeSubscription({ endpoint: FCM, keys: { p256dh: "x".repeat(300), auth: "a" } }), null, "oversized key");
});

test("save → list → get → remove round-trips per user, scopes isolated", () => {
  store.savePushSubscription("alice", { endpoint: FCM, keys });
  store.savePushSubscription("alice", { endpoint: FCM2, keys });
  store.savePushSubscription("bob", { endpoint: FCM, keys });

  assert.equal(store.listPushSubscriptions("alice").length, 2);
  assert.deepEqual(store.listPushSubscriptions("bob").map((r) => r.endpoint), [FCM]);
  assert.equal(store.getPushSubscription("alice", FCM)?.endpoint, FCM);
  assert.equal(store.getPushSubscription("bob", FCM2), null, "bob never registered device-b");

  // Re-saving the same device upserts (stable id from endpoint), not a duplicate.
  store.savePushSubscription("alice", { endpoint: FCM, keys: { p256dh: "new", auth: "new" } });
  assert.equal(store.listPushSubscriptions("alice").length, 2);
  assert.equal(store.getPushSubscription("alice", FCM)?.keys.p256dh, "new");

  assert.equal(store.removePushSubscription("alice", FCM), true);
  assert.equal(store.removePushSubscription("alice", FCM), false, "already gone");
  assert.equal(store.listPushSubscriptions("alice").length, 1);
});

test("removePushSubscriptionById prunes by the stored id (delivery-path prune)", () => {
  const row = store.savePushSubscription("carol", { endpoint: FCM, keys });
  assert.equal(store.removePushSubscriptionById("carol", row.id), true);
  assert.equal(store.listPushSubscriptions("carol").length, 0);
});
