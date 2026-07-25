import { test } from "node:test";
import assert from "node:assert/strict";
import { getPreset } from "@workspace/backend-catalogue";
import { planPresetApply, PresetError } from "./preset-apply";

/** The pure preset-apply planner: resolve a preset into the ruleset bundle + starter template + follow-ups.
 *  (The caller resolves the preset from system+org config first; here we feed the shipped one directly.) */

test("plans the Scrum preset: ruleset bundle + starter template + follow-ups", () => {
  const plan = planPresetApply(getPreset("scrum-team"), []);
  assert.equal(plan.preset.id, "scrum-team");
  assert.ok(plan.rulesetBundle, "the scrum reference ruleset resolves");
  assert.ok(plan.template, "the scrum-starter template resolves");
  assert.equal(plan.template!.id, "scrum-starter");
  assert.equal(plan.followUps.methodologyComposition, "scrum");
  assert.equal(plan.followUps.settingsPreset, "growth-business");
  assert.equal(plan.followUps.dashboardPreset, "project-manager-today");
});

test("an org override of the starter template wins over the shipped one", () => {
  const plan = planPresetApply(getPreset("scrum-team"), [{ id: "scrum-starter", label: "Org scrum", seedIssues: [{ title: "Only one" }] }]);
  assert.equal(plan.template!.label, "Org scrum");
  assert.equal(plan.template!.seedIssues!.length, 1);
});

test("an unknown preset throws a 404 PresetError", () => {
  assert.throws(() => planPresetApply(undefined, []), (e) => e instanceof PresetError && e.status === 404);
});
