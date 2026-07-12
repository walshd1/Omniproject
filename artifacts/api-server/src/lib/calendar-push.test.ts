import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeGrant, NO_GRANT } from "./calendar-push";

const NOW = "2026-07-12T00:00:00.000Z";

test("granting requires a valid target — you can't consent to pushing nowhere", () => {
  assert.deepEqual(sanitizeGrant({ granted: true }, NOW), NO_GRANT); // no target ⇒ not granted
  assert.deepEqual(sanitizeGrant({ granted: true, target: "nope" }, NOW), NO_GRANT);
  const ok = sanitizeGrant({ granted: true, target: "google-calendar", scope: "all" }, NOW);
  assert.deepEqual(ok, { granted: true, target: "google-calendar", scope: "all", grantedAt: NOW });
});

test("revoking clears grantedAt; scope defaults to mine", () => {
  const revoked = sanitizeGrant({ granted: false, target: "outlook-calendar" }, NOW);
  assert.equal(revoked.granted, false);
  assert.equal(revoked.grantedAt, null);
  assert.equal(sanitizeGrant({ granted: true, target: "outlook-calendar" }, NOW).scope, "mine");
});

test("the default is not-granted", () => {
  assert.equal(NO_GRANT.granted, false);
  assert.equal(NO_GRANT.target, null);
});
