import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Nomenclature-preset tests — a vendor's wording (from its JSON) is offered as a
 * one-click preset and applied through the label-override allow-list. The overrides live as an org
 * `label-overrides` config def, so enable the sealed store.
 */
process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nomenclature-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

const { nomenclaturePresets, applyNomenclaturePreset } = await import("../lib/nomenclature");
const { effectiveLabels, saveLabels } = await import("../lib/labels");

after(() => fs.rmSync(CONFIG_DIR, { recursive: true, force: true }));

test("presets expose vendors that ship a nomenclature map", () => {
  const presets = nomenclaturePresets();
  const zendesk = presets.find((p) => p.backendId === "zendesk");
  assert.ok(zendesk, "zendesk should ship a nomenclature preset");
  assert.equal(zendesk!.terms["term.issue"], "Ticket");
  // Vendors without a preset are absent.
  assert.equal(presets.find((p) => p.backendId === "openproject"), undefined);
});

test("applying a preset writes the vendor's terms to the label overrides", () => {
  saveLabels({});
  const saved = applyNomenclaturePreset("servicenow");
  assert.ok(saved);
  assert.equal(saved!["term.issue"], "Incident");
  assert.equal(effectiveLabels().overrides["term.issue"], "Incident");
  saveLabels({});
});

test("applying an unknown preset returns null (no change)", () => {
  assert.equal(applyNomenclaturePreset("does-not-exist"), null);
});
