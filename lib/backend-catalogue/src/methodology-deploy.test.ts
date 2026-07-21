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
});

test("a methodology with a ruleset but no invariants still resolves (scrum)", () => {
  const dep = resolveMethodologyDeployment("scrum");
  assert.ok(dep);
  assert.equal(dep!.ruleset?.id, "scrum");
  assert.deepEqual(dep!.invariants, []); // scrum ships no cross-entity invariant
  // Its tagged surfaces are enabled (scrum-overview at minimum).
  assert.ok(dep!.compositionItemIds.includes("screen:scrum-overview"));
});

test("composition item ids are de-duplicated and an unknown methodology is null", () => {
  const dep = resolveMethodologyDeployment("gtd");
  assert.equal(new Set(dep!.compositionItemIds).size, dep!.compositionItemIds.length);
  assert.equal(resolveMethodologyDeployment("no-such-methodology"), null);
});
