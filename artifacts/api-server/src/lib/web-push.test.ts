import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { isAllowedPushEndpoint, classifyPushError, vapidConfig, pushConfigured, sendPush } from "./web-push";

/** The Web Push wrapper — endpoint egress allow-list, error classification, and the VAPID config gate. */

afterEach(() => { delete process.env["VAPID_PUBLIC_KEY"]; delete process.env["VAPID_PRIVATE_KEY"]; delete process.env["VAPID_SUBJECT"]; });

test("only https endpoints on known push services are allowed (SSRF bound)", () => {
  assert.ok(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc"));
  assert.ok(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc"));
  assert.ok(isAllowedPushEndpoint("https://xyz.notify.windows.com/w/?token=abc"));
  assert.ok(isAllowedPushEndpoint("https://web.push.apple.com/abc"));
  // Rejections: non-https, internal host, look-alike, non-url.
  assert.ok(!isAllowedPushEndpoint("http://fcm.googleapis.com/x"), "http refused");
  assert.ok(!isAllowedPushEndpoint("https://169.254.169.254/latest"), "internal host refused");
  assert.ok(!isAllowedPushEndpoint("https://fcm.googleapis.com.evil.example/x"), "look-alike host refused");
  assert.ok(!isAllowedPushEndpoint("not-a-url"), "garbage refused");
  assert.ok(!isAllowedPushEndpoint(42), "non-string refused");
});

test("classifyPushError marks 404/410 as gone (prune), others not", () => {
  assert.deepEqual(classifyPushError(410), { ok: false, statusCode: 410, gone: true });
  assert.deepEqual(classifyPushError(404), { ok: false, statusCode: 404, gone: true });
  assert.deepEqual(classifyPushError(500), { ok: false, statusCode: 500, gone: false });
  assert.deepEqual(classifyPushError(undefined), { ok: false, gone: false });
});

test("vapidConfig / pushConfigured gate on the configured keys", () => {
  assert.equal(vapidConfig(), null);
  assert.equal(pushConfigured(), false);
  process.env["VAPID_PUBLIC_KEY"] = "pub";
  process.env["VAPID_PRIVATE_KEY"] = "priv";
  assert.equal(pushConfigured(), true);
  assert.equal(vapidConfig()?.subject, "mailto:admin@omniproject.local"); // default subject
  process.env["VAPID_SUBJECT"] = "mailto:ops@x.io";
  assert.equal(vapidConfig()?.subject, "mailto:ops@x.io");
});

test("sendPush refuses (without hitting the network) when unconfigured or the endpoint is disallowed", async () => {
  const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: "p", auth: "a" } };
  assert.deepEqual(await sendPush(subscription, { title: "hi" }), { ok: false, gone: false }); // unconfigured
  process.env["VAPID_PUBLIC_KEY"] = "pub";
  process.env["VAPID_PRIVATE_KEY"] = "priv";
  assert.deepEqual(await sendPush({ endpoint: "https://evil.example/x", keys: { p256dh: "p", auth: "a" } }, { title: "hi" }), { ok: false, gone: false });
});
