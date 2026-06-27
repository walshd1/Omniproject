import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NOTIFICATION_KINDS,
  KNOWN_NOTIFICATION_KINDS,
  getNotificationKind,
  notificationKindCatalogue,
  notificationSeverity,
} from "./notification-kinds";

test("the kind registry is id-unique and every kind has a valid severity", () => {
  const ids = NOTIFICATION_KINDS.map((k) => k.id);
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");
  for (const k of NOTIFICATION_KINDS) {
    assert.ok(["info", "warning", "critical"].includes(k.severity), `${k.id} has an invalid severity`);
    assert.ok(k.label, `${k.id} missing a label`);
  }
  assert.equal(KNOWN_NOTIFICATION_KINDS.size, ids.length);
});

test("getNotificationKind / notificationSeverity resolve known kinds and default unknown to info", () => {
  assert.equal(getNotificationKind("blocker")?.severity, "critical");
  assert.equal(notificationSeverity("incident"), "critical");
  assert.equal(notificationSeverity("due_soon"), "warning");
  // An unknown/free-form kind is accepted but treated as informational.
  assert.equal(getNotificationKind("totally-made-up"), undefined);
  assert.equal(notificationSeverity("totally-made-up"), "info");
});

test("notificationKindCatalogue returns a defensive copy", () => {
  const a = notificationKindCatalogue();
  a[0]!.label = "mutated";
  assert.notEqual(notificationKindCatalogue()[0]!.label, "mutated");
});
