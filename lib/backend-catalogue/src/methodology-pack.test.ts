import { test } from "node:test";
import assert from "node:assert/strict";
import { methodologyPack, allMethodologyTags } from "./methodology-pack";
import { getMethodology, METHODOLOGIES } from "./methodology-catalogue";
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

test("the pack's ruleset + routes + reports + screens all match the methodology", () => {
  const pack = methodologyPack("scrum")!;
  if (pack.ruleset) assert.equal(pack.ruleset.methodology, "scrum");
  for (const r of pack.notificationRoutes) assert.ok(r.methodologies.includes("scrum"));
  for (const r of pack.reports) assert.ok(r.methodologies?.includes("scrum"));
  for (const s of pack.screens) assert.ok(s.methodologies?.includes("scrum"));
  // Scrum tags the burndown + velocity reports — they belong in the pack.
  assert.ok(pack.reports.some((r) => r.id === "burndown"));
});

test("allMethodologyTags is the cross-plane derived picker list (every defined methodology + asset tag)", () => {
  const tags = allMethodologyTags();
  // Every defined methodology is pickable.
  for (const m of METHODOLOGIES) assert.ok(tags.includes(m.id), `${m.id} should be pickable`);
  // Deduped, neutral-free, sorted.
  assert.equal(new Set(tags).size, tags.length);
  assert.ok(!tags.includes("*"));
  assert.deepEqual(tags, [...tags].sort());
});

test("every shipped methodology yields a non-null pack; an unknown id yields null", () => {
  assert.equal(methodologyPack("not-a-methodology"), null);
  for (const id of ["scrum", "kanban", "waterfall", "prince2", "safe", "scrumban"]) {
    const pack = methodologyPack(id);
    assert.ok(pack && getMethodology(id), `${id} should produce a pack`);
  }
});
