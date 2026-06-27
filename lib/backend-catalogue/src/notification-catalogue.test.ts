import { test } from "node:test";
import assert from "node:assert/strict";
import { NOTIFICATIONS, notificationCatalogue, getNotificationChannel } from "./notification-catalogue";

test("the notification registry lists the channels with capabilities + tools", () => {
  const ids = NOTIFICATIONS.map((n) => n.id);
  for (const expected of ["slack", "teams", "email", "pagerduty", "generic-webhook"]) {
    assert.ok(ids.includes(expected), `missing channel ${expected}`);
  }
  for (const n of NOTIFICATIONS) {
    assert.ok(n.label && n.docsUrl && n.kind, `${n.id} missing fields`);
    assert.ok(Array.isArray(n.tools));
    assert.ok(typeof n.capabilities.channels === "boolean" && n.capabilities.delivery);
  }
});

test("capabilities and tools are separate but linked per channel", () => {
  const slack = getNotificationChannel("slack");
  assert.equal(slack?.kind, "chat");
  assert.equal(slack?.capabilities.richFormatting, true);
  assert.equal(slack?.capabilities.inboundReply, true); // Slack is two-way
  assert.ok(slack?.tools.includes("notification"));
});

test("channel capabilities are honestly differentiated", () => {
  const cat = notificationCatalogue();
  // Teams posts are one-way via connector; PagerDuty is incident-only, no DMs.
  assert.equal(cat.find((n) => n.id === "teams")?.capabilities.inboundReply, false);
  assert.equal(cat.find((n) => n.id === "pagerduty")?.kind, "incident");
  assert.equal(cat.find((n) => n.id === "email")?.capabilities.channels, false);
});
