import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DASHBOARD_PRESETS,
  dashboardPreset,
  presetForRole,
  dashboardPresetCatalogue,
  availablePresets,
} from "./dashboard-preset-catalogue";
import { widgetDef } from "./widget-catalogue";

test("the preset catalogue is populated and ordered", () => {
  assert.ok(DASHBOARD_PRESETS.length >= 5);
  const orders = DASHBOARD_PRESETS.map((p) => p.order ?? 0);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
});

test("there is exactly one preset per role persona", () => {
  const roles = DASHBOARD_PRESETS.map((p) => p.role).sort();
  // The three org-chart-level personas, plus the two charity report audiences
  // (trustee/funder) the "We're a charity" onboarding preset applies.
  assert.deepEqual(roles, ["funder", "head-of-projects", "programme-manager", "project-manager", "trustee"]);
});

test("every preset references only real widget types and places at least one", () => {
  for (const p of DASHBOARD_PRESETS) {
    assert.ok(p.widgets.length > 0, `${p.id} places no widgets`);
    for (const w of p.widgets) {
      assert.ok(widgetDef(w.type), `${p.id} references unknown widget "${w.type}"`);
    }
  }
});

test("presetForRole finds the role's suggested default", () => {
  assert.equal(presetForRole("project-manager")?.id, "project-manager-today");
  assert.equal(presetForRole("nope"), undefined);
});

test("dashboardPreset looks a preset up by id", () => {
  assert.equal(dashboardPreset("head-of-projects-today")?.role, "head-of-projects");
  assert.equal(dashboardPreset("nope"), undefined);
});

test("availablePresets drops presets needing an entity the backend can't surface", () => {
  // The programme-manager preset uses programmeCount (requiresEntity: programme).
  assert.ok(widgetDef("programmeCount")?.requiresEntity === "programme");
  const all = availablePresets(() => true).map((p) => p.id);
  assert.ok(all.includes("programme-manager-today"));
  const noProgramme = availablePresets((e) => e !== "programme").map((p) => p.id);
  assert.ok(!noProgramme.includes("programme-manager-today"));
  // Presets without a gated widget stay available.
  assert.ok(noProgramme.includes("project-manager-today"));
});

test("dashboardPresetCatalogue returns a deep defensive copy", () => {
  const a = dashboardPresetCatalogue();
  a[0]!.name = "mutated";
  a[0]!.widgets[0]!.type = "mutated";
  assert.notEqual(dashboardPreset(a[0]!.id)?.name, "mutated");
  assert.notEqual(dashboardPreset(a[0]!.id)?.widgets[0]?.type, "mutated");
});
