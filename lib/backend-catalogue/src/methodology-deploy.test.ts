import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMethodologyDeployment } from "./methodology-deploy";

test("GTD's one-click deploy plan turns on its screen + ruleset and carries its invariant", () => {
  const dep = resolveMethodologyDeployment("gtd");
  assert.ok(dep);
  // The composition set enables the GTD overview screen and the GTD ruleset (prefixed composition ids).
  assert.ok(dep!.compositionItemIds.includes("screen:gtd-overview"), "enables the GTD overview screen");
  assert.ok(dep!.compositionItemIds.includes("ruleset:gtd"), "enables the GTD reference ruleset");
  assert.equal(dep!.ruleset?.id, "gtd");
  // The GTD business rule rides along for the scope to register.
  assert.equal(dep!.invariants.length, 1);
  assert.equal(dep!.invariants[0]!.kind, "every-active-project-has-next-action");
  assert.equal(dep!.summary.hasRuleset, true);
  assert.ok(dep!.summary.screens >= 1);
  // The bundle carries the methodology's nomenclature (the GTD list names + relabelled vocab).
  assert.deepEqual(dep!.nomenclature.states, ["inbox", "next", "waiting", "scheduled", "someday", "done"]);
  assert.ok(dep!.nomenclature.ceremonies.includes("weekly-review"));
  assert.ok(dep!.nomenclature.statuses.every((s) => typeof s.label === "string" && s.label.length > 0));
  assert.ok(dep!.nomenclature.priorities.length > 0);
});

test("a methodology with a ruleset but no invariants still resolves (scrum)", () => {
  const dep = resolveMethodologyDeployment("scrum");
  assert.ok(dep);
  assert.equal(dep!.ruleset?.id, "scrum");
  assert.deepEqual(dep!.invariants, []); // scrum ships no cross-entity invariant
  // Its tagged surfaces are enabled (scrum-overview at minimum).
  assert.ok(dep!.compositionItemIds.includes("screen:scrum-overview"));
});

test("the deploy plan carries the methodology's preset SETTINGS block (posture)", () => {
  // Scrum lands a WSJF-weighted prioritisation as a first-class settings field.
  const scrum = resolveMethodologyDeployment("scrum");
  assert.ok(scrum);
  assert.equal(scrum!.summary.settings, 1);
  assert.deepEqual(scrum!.settings["priorityWeights"], { rice: 20, wsjf: 40, moscow: 10, strategic: 20, benefit: 10 });

  // Waterfall lands period-close FX + a strategy-weighted prioritisation.
  const wf = resolveMethodologyDeployment("waterfall");
  assert.ok(wf);
  assert.equal(wf!.settings["fxRatePolicy"], "periodClose");
  assert.equal(wf!.summary.settings, 2);

  // A methodology with no settings block yields an empty (never undefined) settings map.
  const gtd = resolveMethodologyDeployment("gtd");
  assert.deepEqual(gtd!.settings, {});
  assert.equal(gtd!.summary.settings, 0);
});

test("composition item ids are de-duplicated and an unknown methodology is null", () => {
  const dep = resolveMethodologyDeployment("gtd");
  assert.equal(new Set(dep!.compositionItemIds).size, dep!.compositionItemIds.length);
  assert.equal(resolveMethodologyDeployment("no-such-methodology"), null);
});
