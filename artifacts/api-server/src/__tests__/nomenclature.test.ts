import { test } from "node:test";
import assert from "node:assert/strict";
import { nomenclaturePresets, applyNomenclaturePreset } from "../lib/nomenclature";
import { effectiveLabels } from "../lib/labels";
import { updateSettings } from "../lib/settings";

/**
 * Nomenclature-preset tests — a vendor's wording (from its JSON) is offered as a
 * one-click preset and applied through the label-override allow-list.
 */

test("presets expose vendors that ship a nomenclature map", () => {
  const presets = nomenclaturePresets();
  const zendesk = presets.find((p) => p.backendId === "zendesk");
  assert.ok(zendesk, "zendesk should ship a nomenclature preset");
  assert.equal(zendesk!.terms["term.issue"], "Ticket");
  // Vendors without a preset are absent.
  assert.equal(presets.find((p) => p.backendId === "openproject"), undefined);
});

test("applying a preset writes the vendor's terms to the label overrides", () => {
  updateSettings({ labelOverrides: {} });
  const saved = applyNomenclaturePreset("servicenow");
  assert.ok(saved);
  assert.equal(saved!["term.issue"], "Incident");
  assert.equal(effectiveLabels().overrides["term.issue"], "Incident");
  updateSettings({ labelOverrides: {} });
});

test("applying an unknown preset returns null (no change)", () => {
  assert.equal(applyNomenclaturePreset("does-not-exist"), null);
});
