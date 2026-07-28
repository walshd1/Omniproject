import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_NOTIFICATION_PREFS,
  sanitizeNotificationPrefs,
  inQuietHours,
  allowedChannels,
  acceptsInApp,
  type NotificationPrefs,
} from "./notification-prefs";

const at = (h: number, m = 0) => new Date(2026, 0, 1, h, m, 0);

test("defaults: all channels on, nothing muted, quiet hours off", () => {
  assert.deepEqual(DEFAULT_NOTIFICATION_PREFS.channels, { inApp: true, email: true, push: true });
  assert.deepEqual(DEFAULT_NOTIFICATION_PREFS.mutedKinds, []);
  assert.equal(DEFAULT_NOTIFICATION_PREFS.quietHours.enabled, false);
});

test("sanitize: partial input opts in by default, drops unknown kinds + malformed times", () => {
  const p = sanitizeNotificationPrefs({
    channels: { push: false, bogus: true },
    mutedKinds: ["mention", "mention", "not_a_kind", 42],
    quietHours: { enabled: true, start: "25:99", end: "07:30" },
  });
  assert.deepEqual(p.channels, { inApp: true, email: true, push: false }); // push off; others default-on
  assert.deepEqual(p.mutedKinds, ["mention"]); // deduped, unknown/non-string dropped
  assert.equal(p.quietHours.enabled, true);
  assert.equal(p.quietHours.start, DEFAULT_NOTIFICATION_PREFS.quietHours.start); // "25:99" rejected → default
  assert.equal(p.quietHours.end, "07:30");
});

test("sanitize: empty/garbage input yields the defaults", () => {
  assert.deepEqual(sanitizeNotificationPrefs(undefined), DEFAULT_NOTIFICATION_PREFS);
  assert.deepEqual(sanitizeNotificationPrefs("nope"), DEFAULT_NOTIFICATION_PREFS);
});

test("inQuietHours: same-day window", () => {
  const p = sanitizeNotificationPrefs({ quietHours: { enabled: true, start: "09:00", end: "17:00" } });
  assert.equal(inQuietHours(p, at(8, 59)), false);
  assert.equal(inQuietHours(p, at(9, 0)), true);
  assert.equal(inQuietHours(p, at(16, 59)), true);
  assert.equal(inQuietHours(p, at(17, 0)), false); // end is exclusive
});

test("inQuietHours: window wrapping past midnight (22:00→07:00)", () => {
  const p = sanitizeNotificationPrefs({ quietHours: { enabled: true, start: "22:00", end: "07:00" } });
  assert.equal(inQuietHours(p, at(23)), true);
  assert.equal(inQuietHours(p, at(3)), true);
  assert.equal(inQuietHours(p, at(7)), false);
  assert.equal(inQuietHours(p, at(12)), false);
});

test("inQuietHours: disabled or degenerate window is never active", () => {
  assert.equal(inQuietHours(sanitizeNotificationPrefs({ quietHours: { enabled: false, start: "22:00", end: "07:00" } }), at(23)), false);
  assert.equal(inQuietHours(sanitizeNotificationPrefs({ quietHours: { enabled: true, start: "09:00", end: "09:00" } }), at(9)), false);
});

test("allowedChannels: default prefs → every channel for an info kind", () => {
  assert.deepEqual(allowedChannels(DEFAULT_NOTIFICATION_PREFS, "assignment", at(12)), ["inApp", "email", "push"]);
});

test("allowedChannels: a muted non-critical kind is fully silenced", () => {
  const p = sanitizeNotificationPrefs({ mutedKinds: ["mention"] });
  assert.deepEqual(allowedChannels(p, "mention", at(12)), []);
  assert.deepEqual(allowedChannels(p, "assignment", at(12)), ["inApp", "email", "push"]); // other kinds unaffected
});

test("allowedChannels: critical is NEVER suppressed — mute + quiet hours are bypassed", () => {
  const p = sanitizeNotificationPrefs({ mutedKinds: ["incident", "blocker"], quietHours: { enabled: true, start: "00:00", end: "23:59" } });
  assert.deepEqual(allowedChannels(p, "incident", at(3)), ["inApp", "email", "push"]);
  assert.deepEqual(allowedChannels(p, "blocker", at(3)), ["inApp", "email", "push"]);
});

test("allowedChannels: critical always reaches the in-app bell even when the in-app channel is off", () => {
  // The in-app bell is the guaranteed floor for emergencies — a disabled in-app toggle can't silence a
  // critical event there, though a disabled email/push toggle is still respected.
  const p = sanitizeNotificationPrefs({ channels: { inApp: false, push: false } });
  assert.deepEqual(allowedChannels(p, "incident", at(3)), ["inApp", "email"]);
  assert.equal(acceptsInApp(p, "incident", at(3)), true);
});

test("allowedChannels: quiet hours hold email/push but keep the in-app bell (non-critical)", () => {
  const p = sanitizeNotificationPrefs({ quietHours: { enabled: true, start: "22:00", end: "07:00" } });
  assert.deepEqual(allowedChannels(p, "due_soon", at(23)), ["inApp"]); // warning during quiet hours
  assert.deepEqual(allowedChannels(p, "due_soon", at(12)), ["inApp", "email", "push"]); // outside quiet hours
});

test("allowedChannels: a disabled channel is dropped everywhere", () => {
  const p = sanitizeNotificationPrefs({ channels: { inApp: false } });
  assert.deepEqual(allowedChannels(p, "assignment", at(12)), ["email", "push"]);
  assert.equal(acceptsInApp(p, "assignment", at(12)), false);
});

test("acceptsInApp: gates the in-app plane on channel + mute, but not on quiet hours", () => {
  const base: NotificationPrefs = DEFAULT_NOTIFICATION_PREFS;
  assert.equal(acceptsInApp(base, "assignment", at(12)), true);
  assert.equal(acceptsInApp(sanitizeNotificationPrefs({ mutedKinds: ["assignment"] }), "assignment", at(12)), false);
  // quiet hours keeps the in-app bell for a non-critical event:
  assert.equal(acceptsInApp(sanitizeNotificationPrefs({ quietHours: { enabled: true, start: "00:00", end: "23:59" } }), "assignment", at(12)), true);
});
