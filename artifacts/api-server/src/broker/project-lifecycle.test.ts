import { test } from "node:test";
import assert from "node:assert/strict";
import { isProjectLive, normaliseProjectStatus, PROJECT_STATUS_CLASS } from "./vocabulary";

test("normaliseProjectStatus folds vendor dialects onto canonical states", () => {
  assert.equal(normaliseProjectStatus("In Progress"), "active");
  assert.equal(normaliseProjectStatus("On Hold"), "on_hold");
  assert.equal(normaliseProjectStatus("Closed"), "completed");
  assert.equal(normaliseProjectStatus("DONE"), "completed");
  assert.equal(normaliseProjectStatus("Archived"), "archived");
  assert.equal(normaliseProjectStatus("Cancelled"), "cancelled");
  assert.equal(normaliseProjectStatus("banana"), null); // unclassifiable
  assert.equal(normaliseProjectStatus(""), null);
});

test("isProjectLive: active/on_hold are live; completed/archived/cancelled are closed", () => {
  assert.equal(isProjectLive("active"), true);
  assert.equal(isProjectLive("on hold"), true);
  assert.equal(isProjectLive("completed"), false);
  assert.equal(isProjectLive("archived"), false);
  assert.equal(isProjectLive("cancelled"), false);
});

test("isProjectLive is default-safe: no/unknown status ⇒ live (never hidden)", () => {
  assert.equal(isProjectLive(undefined), true);
  assert.equal(isProjectLive(null), true);
  assert.equal(isProjectLive(""), true);
  assert.equal(isProjectLive("some-bespoke-vendor-state"), true);
});

test("every canonical project status maps to a lifecycle class", () => {
  for (const cls of Object.values(PROJECT_STATUS_CLASS)) assert.ok(cls === "live" || cls === "closed");
});
