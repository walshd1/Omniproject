import test from "node:test";
import assert from "node:assert/strict";
import { PRESETS, presetCatalogue, getPreset, presetReferenceErrors, isPresetConsistent } from "./preset-catalogue";
import { getMethodology, getReferenceRuleset, getProjectTemplate, dashboardPreset } from "./index";

/**
 * Preset catalogue drift guard: every shipped preset is internally consistent — each reference (methodology,
 * reference ruleset, project template, dashboard preset) resolves against the catalogue it points at. A preset
 * that names a piece that doesn't exist would silently half-apply, so this pins that it can't ship.
 */

test("every shipped preset's references resolve (no dangling methodology/ruleset/template/dashboard)", () => {
  assert.ok(PRESETS.length > 0, "at least one preset ships");
  for (const p of PRESETS) {
    assert.deepEqual(presetReferenceErrors(p), [], `${p.id}: ${presetReferenceErrors(p).join("; ")}`);
    assert.equal(isPresetConsistent(p), true);
  }
});

test("the Scrum team preset binds the real Scrum pieces", () => {
  const scrum = getPreset("scrum-team");
  assert.ok(scrum, "scrum-team ships");
  assert.equal(scrum!.methodology, "scrum");
  // Each reference resolves to a real catalogue entry.
  assert.ok(getMethodology(scrum!.methodology), "methodology resolves");
  assert.ok(getReferenceRuleset(scrum!.referenceRuleset!), "reference ruleset resolves");
  assert.ok(getProjectTemplate(scrum!.projectTemplate!), "project template resolves");
  assert.ok(dashboardPreset(scrum!.dashboardPreset!), "dashboard preset resolves");
  // settingsPreset is an opaque id validated server-side (not in this catalogue).
  assert.equal(scrum!.settingsPreset, "growth-business");
});

test("a dangling reference is reported (the guard actually bites)", () => {
  const bad = { id: "x", label: "X", description: "d", methodology: "nope-not-real", order: 1 };
  const errs = presetReferenceErrors(bad);
  assert.ok(errs.some((e) => /methodology "nope-not-real" does not resolve/.test(e)));
  assert.equal(isPresetConsistent(bad), false);
});

test("catalogue accessors: ordered list + defensive copy + lookup", () => {
  assert.deepEqual(presetCatalogue().map((p) => p.id), PRESETS.map((p) => p.id));
  assert.notEqual(presetCatalogue()[0], PRESETS[0]); // a copy, not the same object
  assert.equal(getPreset("does-not-exist"), undefined);
});
