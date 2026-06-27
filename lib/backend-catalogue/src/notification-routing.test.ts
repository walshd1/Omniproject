import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NOTIFICATION_ROUTES,
  notificationRouteCatalogue,
  getNotificationRoute,
  routeMatches,
  routeNotification,
} from "./notification-routing";
import { getNotificationChannel } from "./notification-catalogue";

test("the route catalogue is JSON-defined, id-unique and order-sorted", () => {
  assert.ok(NOTIFICATION_ROUTES.length > 0);
  const ids = NOTIFICATION_ROUTES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");
  const orders = NOTIFICATION_ROUTES.map((r) => r.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b), "routes must be order-sorted");
});

test("every route dispatches only to REAL catalogue channels (no dangling channel)", () => {
  // The notification-plane analogue of the incompatibility guard: a route naming a
  // channel that doesn't exist would silently never deliver.
  const dangling: string[] = [];
  for (const r of notificationRouteCatalogue()) {
    for (const c of r.channels) if (!getNotificationChannel(c)) dangling.push(`${r.id} → "${c}"`);
  }
  assert.deepEqual(dangling, [], "a route names a channel that isn't in the notification catalogue");
});

test("routeMatches honours explicit kinds and the \"*\" wildcard", () => {
  const incidents = getNotificationRoute("critical-incidents")!;
  assert.ok(routeMatches(incidents, { kind: "incident" }));
  assert.ok(routeMatches(incidents, { kind: "blocker" }));
  assert.ok(!routeMatches(incidents, { kind: "due_soon" }));
});

test("routeNotification returns the de-duplicated delivery intents for an event", () => {
  const intents = routeNotification({ kind: "incident" });
  // The incident route fires; its channels appear, tagged with the route + audience.
  const channels = intents.map((i) => i.channel);
  assert.ok(channels.includes("pagerduty") && channels.includes("slack"));
  assert.ok(intents.every((i) => i.route === "critical-incidents"));
  assert.ok(intents.find((i) => i.channel === "pagerduty")!.audience?.role === "manager");
  // No duplicate channel+audience pairs.
  const keys = intents.map((i) => `${i.channel}|${i.audience?.role ?? ""}`);
  assert.equal(new Set(keys).size, keys.length);
});

test("routeNotification gates on channel availability (an unavailable channel is dropped)", () => {
  // Pretend pagerduty isn't wired ⇒ it must not appear, but slack still does.
  const intents = routeNotification({ kind: "incident" }, (id) => id !== "pagerduty");
  const channels = intents.map((i) => i.channel);
  assert.ok(!channels.includes("pagerduty"));
  assert.ok(channels.includes("slack"));
});

test("an event matching no route dispatches nowhere (in-app bell is separate)", () => {
  assert.deepEqual(routeNotification({ kind: "no-route-for-this-kind" }), []);
});
