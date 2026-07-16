import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PushPayload, PushResult, StoredSubscription } from "./web-push";

/**
 * The notify-bus Web Push effect: payload mapping, and the gated fan-out to a user's devices with dead-sub
 * pruning. A fake sender is injected so nothing hits the network.
 */

process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod";
process.env["ENABLED_FEATURES"] = "pushNotifications"; // module is default-off
process.env["VAPID_PUBLIC_KEY"] = "pub"; // pushConfigured() ⇒ true
process.env["VAPID_PRIVATE_KEY"] = "priv";

let delivery: typeof import("./push-delivery");
let subs: typeof import("./push-subscriptions");
const FCM = "https://fcm.googleapis.com/fcm/send/a";
const FCM2 = "https://fcm.googleapis.com/fcm/send/b";
const keys = { p256dh: "p", auth: "a" };

before(async () => { delivery = await import("./push-delivery"); subs = await import("./push-subscriptions"); });
beforeEach(() => { process.env["OMNI_CONFIG_DIR"] = fs.mkdtempSync(path.join(os.tmpdir(), "push-deliv-")); });
after(() => { delete process.env["OMNI_CONFIG_DIR"]; delete process.env["ENABLED_FEATURES"]; delete process.env["VAPID_PUBLIC_KEY"]; delete process.env["VAPID_PRIVATE_KEY"]; });

test("toPushPayload maps a notification, requires a title, collapses by id", () => {
  assert.equal(delivery.toPushPayload({ body: "no title" }), null);
  assert.equal(delivery.toPushPayload(null), null);
  assert.deepEqual(delivery.toPushPayload({ title: "Hi", body: "b", url: "/x", id: "n1" }), { title: "Hi", body: "b", url: "/x", tag: "n1" });
  assert.deepEqual(delivery.toPushPayload({ title: "Only" }), { title: "Only" });
});

test("deliverWebPush sends to every device of the target user; broadcasts don't push", async () => {
  subs.savePushSubscription("alice", { endpoint: FCM, keys });
  subs.savePushSubscription("alice", { endpoint: FCM2, keys });
  const sent: string[] = [];
  const send = async (s: StoredSubscription, _p: PushPayload): Promise<PushResult> => { sent.push(s.endpoint); return { ok: true }; };

  await delivery.deliverWebPush({ notification: { title: "Hi", id: "n1" }, target: { sub: "alice" } }, send);
  assert.deepEqual(sent.sort(), [FCM, FCM2].sort());

  sent.length = 0;
  await delivery.deliverWebPush({ notification: { title: "Broadcast" } }, send); // no target.sub
  assert.deepEqual(sent, [], "broadcasts stay on SSE / channels");
});

test("deliverWebPush prunes a subscription the push service reports gone (410)", async () => {
  subs.savePushSubscription("bob", { endpoint: FCM, keys });
  subs.savePushSubscription("bob", { endpoint: FCM2, keys });
  const send = async (s: StoredSubscription, _p: PushPayload): Promise<PushResult> =>
    s.endpoint === FCM ? { ok: false, statusCode: 410, gone: true } : { ok: true };

  await delivery.deliverWebPush({ notification: { title: "Hi" }, target: { sub: "bob" } }, send);
  assert.deepEqual(subs.listPushSubscriptions("bob").map((r) => r.endpoint), [FCM2], "the gone endpoint was pruned");
});
