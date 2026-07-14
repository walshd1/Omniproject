import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { listSettingsPresets, settingsPreset } from "./settings-presets";
import { evaluateConstraints } from "./settings-constraints";
import {
  getSettings, updateSettings, applyBootSettingsPreset, AI_PROVIDERS, STT_PROVIDERS, FX_RATE_POLICIES, type SettingsState,
} from "./settings";
import { DEPLOYMENT_PROFILES } from "./deployment-profile";

/**
 * Every customer-archetype settings blueprint must be KNOWN-GOOD: a valid combination the constraint
 * registry accepts, using only in-range enum values. This is the poka-yoke that stops a preset shipping
 * an illegal combo the setup wizard would then apply.
 */

test("every preset is a known-good combo — no cross-field constraint violations", () => {
  const base = getSettings();
  for (const p of listSettingsPresets()) {
    const merged = { ...base, ...p.settings } as SettingsState;
    const { violations } = evaluateConstraints(merged);
    assert.deepEqual(violations, [], `preset "${p.id}" violates a constraint: ${violations.map((v) => v.message).join("; ")}`);
  }
});

test("every preset uses only in-range enum values + valid priority weights", () => {
  for (const p of listSettingsPresets()) {
    const s = p.settings;
    if (s.deploymentProfile !== undefined) assert.ok((DEPLOYMENT_PROFILES as readonly string[]).includes(s.deploymentProfile), `${p.id}: bad deploymentProfile`);
    if (s.aiProvider !== undefined) assert.ok((AI_PROVIDERS as readonly string[]).includes(s.aiProvider), `${p.id}: bad aiProvider`);
    if (s.sttProvider !== undefined) assert.ok((STT_PROVIDERS as readonly string[]).includes(s.sttProvider), `${p.id}: bad sttProvider`);
    if (s.fxRatePolicy !== undefined) assert.ok((FX_RATE_POLICIES as readonly string[]).includes(s.fxRatePolicy), `${p.id}: bad fxRatePolicy`);
    if (s.priorityWeights) {
      for (const [k, v] of Object.entries(s.priorityWeights)) {
        assert.ok(typeof v === "number" && Number.isFinite(v) && v >= 0, `${p.id}: priorityWeights.${k} must be a non-negative number`);
      }
    }
  }
});

test("gate: every SETTINGS_PRESET referenced in the deploy composes + env recipes is a real blueprint", () => {
  // Repo root, from artifacts/api-server/src/lib.
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..");
  const ids = new Set(listSettingsPresets().map((p) => p.id));
  const referenced: { where: string; id: string }[] = [];

  // Compose defaults: ${SETTINGS_PRESET:-<id>}
  for (const f of ["docker-compose.enterprise.yml", "docker-compose.slim.yml", "docker-compose.standalone.yml"]) {
    const full = path.join(root, f);
    if (!fs.existsSync(full)) continue;
    for (const m of fs.readFileSync(full, "utf8").matchAll(/SETTINGS_PRESET:-([a-z0-9-]+)\}/g)) referenced.push({ where: f, id: m[1]! });
  }
  // Env recipes: SETTINGS_PRESET=<id>
  const presetsDir = path.join(root, "deploy", "presets");
  if (fs.existsSync(presetsDir)) {
    for (const f of fs.readdirSync(presetsDir).filter((n) => n.endsWith(".env"))) {
      for (const m of fs.readFileSync(path.join(presetsDir, f), "utf8").matchAll(/^SETTINGS_PRESET=([a-z0-9-]+)/gm)) referenced.push({ where: `deploy/presets/${f}`, id: m[1]! });
    }
  }

  assert.ok(referenced.length >= 6, `expected to find SETTINGS_PRESET references in the composes/recipes, found ${referenced.length}`);
  const bad = referenced.filter((r) => !ids.has(r.id));
  assert.deepEqual(bad, [], `deploy recipe(s) reference an unknown blueprint id: ${bad.map((b) => `${b.where}→${b.id}`).join(", ")}`);
});

test("applyBootSettingsPreset seeds a named blueprint at boot (SETTINGS_PRESET / compose glue)", () => {
  const before = getSettings();
  try {
    applyBootSettingsPreset("nonprofit");
    assert.equal(getSettings().deploymentProfile, "nonprofit");
    assert.deepEqual(getSettings().disabledFeatures, ["odata", "integrations"]);
    assert.doesNotThrow(() => applyBootSettingsPreset("does-not-exist")); // unknown id ⇒ best-effort no-op
    assert.doesNotThrow(() => applyBootSettingsPreset(undefined)); // unset ⇒ no-op
    assert.equal(getSettings().deploymentProfile, "nonprofit"); // unchanged by the no-ops
  } finally {
    updateSettings({
      deploymentProfile: before.deploymentProfile, disabledFeatures: before.disabledFeatures,
      reportingCurrency: before.reportingCurrency, fxRatePolicy: before.fxRatePolicy,
      aiProvider: before.aiProvider, sttProvider: before.sttProvider, priorityWeights: before.priorityWeights,
    });
  }
});

test("preset ids are unique, non-empty, and each carries a label + audience + description", () => {
  const presets = listSettingsPresets();
  assert.ok(presets.length >= 5);
  const ids = presets.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate preset id");
  for (const p of presets) {
    assert.ok(p.id && p.label && p.audience && p.description, `preset ${p.id} is missing a field`);
    assert.equal(settingsPreset(p.id)?.id, p.id); // lookup round-trips
  }
  assert.equal(settingsPreset("does-not-exist"), null);
});
