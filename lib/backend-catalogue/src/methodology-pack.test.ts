import { test } from "node:test";
import assert from "node:assert/strict";
import { methodologyPack } from "./methodology-pack";
import { getMethodology } from "./methodology-catalogue";
import { VIEWS } from "./view-catalogue";

test("a methodology pack bundles the definition + only its tagged assets", () => {
  const pack = methodologyPack("kanban")!;
  assert.ok(pack, "kanban pack should exist");
  assert.equal(pack.methodology.id, "kanban");
  // Every view in the pack is tagged with kanban specifically (not a neutral "*" view).
  for (const v of pack.views) assert.ok(v.methodologies.includes("kanban"), `${v.id} should be a kanban view`);
  // The Kanban board view is in the pack; a neutral view (tagged "*") is not.
  assert.ok(pack.views.some((v) => v.id === "kanban"));
  const neutral = VIEWS.find((v) => v.methodologies.includes("*") && !v.methodologies.includes("kanban"));
  if (neutral) assert.ok(!pack.views.some((v) => v.id === neutral.id), "neutral views are not part of a pack");
});

test("the pack's ruleset + routes match the methodology (or are empty, never wrong)", () => {
  const pack = methodologyPack("scrum")!;
  if (pack.ruleset) assert.equal(pack.ruleset.methodology, "scrum");
  for (const r of pack.notificationRoutes) assert.ok(r.methodologies.includes("scrum"));
});

test("every shipped methodology yields a non-null pack; an unknown id yields null", () => {
  assert.equal(methodologyPack("not-a-methodology"), null);
  for (const id of ["scrum", "kanban", "waterfall", "prince2", "safe", "scrumban"]) {
    const pack = methodologyPack(id);
    assert.ok(pack && getMethodology(id), `${id} should produce a pack`);
  }
});
