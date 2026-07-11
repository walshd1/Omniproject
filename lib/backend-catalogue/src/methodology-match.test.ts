import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesMethodology } from "./methodology-match";

test("neutral entries (undefined / wildcard) apply to every methodology", () => {
  assert.equal(matchesMethodology(undefined, "scrum"), true); // the guard view-catalogue used to lack
  assert.equal(matchesMethodology(["*"], "scrum"), true);
  assert.equal(matchesMethodology(["*", "kanban"], "scrum"), true);
});

test("tagged entries apply only to a methodology they carry", () => {
  assert.equal(matchesMethodology(["scrum"], "scrum"), true);
  assert.equal(matchesMethodology(["kanban"], "scrum"), false);
  assert.equal(matchesMethodology(["kanban", "safe"], "safe"), true);
});

test("an empty tag list matches nothing (not neutral)", () => {
  assert.equal(matchesMethodology([], "scrum"), false);
});
