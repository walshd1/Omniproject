import { test } from "node:test";
import assert from "node:assert/strict";
import { getNotificationRoute, routeMatches, routeNotification } from "./notification-routing";
import { getNotificationChannel } from "./notification-catalogue";
import { getNotificationKind, KNOWN_NOTIFICATION_KINDS } from "./notification-kinds";

test("the `digest` kind is registered as an informational kind", () => {
  const kind = getNotificationKind("digest");
  assert.ok(kind, "digest kind must be in the registry");
  assert.equal(kind!.severity, "info");
  assert.ok(KNOWN_NOTIFICATION_KINDS.has("digest"));
});

test("the default digest route exists, targets managers and names real channels", () => {
  const route = getNotificationRoute("digest");
  assert.ok(route, "a default digest route must ship");
  assert.deepEqual(route!.match.kinds, ["digest"]);
  assert.equal(route!.audience?.role, "manager");
  // Delivered where the PM already lives — email + team chat — and every channel is real.
  for (const c of route!.channels) assert.ok(getNotificationChannel(c), `digest route names a missing channel: ${c}`);
  assert.ok(route!.channels.includes("email"));
});

test("a digest event dispatches through the existing engine to the digest route's channels", () => {
  assert.ok(routeMatches(getNotificationRoute("digest")!, { kind: "digest" }));

  const intents = routeNotification({ kind: "digest" });
  const channels = intents.map((i) => i.channel);
  assert.ok(channels.length > 0, "a digest must dispatch somewhere");
  assert.ok(intents.every((i) => i.route === "digest"));
  assert.ok(intents.every((i) => i.audience?.role === "manager"));
});

test("digest dispatch honours channel availability (an unwired channel is dropped)", () => {
  const intents = routeNotification({ kind: "digest" }, (id) => id !== "slack");
  const channels = intents.map((i) => i.channel);
  assert.ok(!channels.includes("slack"));
  assert.ok(channels.includes("email"));
});
