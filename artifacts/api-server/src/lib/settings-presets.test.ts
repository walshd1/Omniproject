import { test } from "node:test";
import assert from "node:assert/strict";
import { listSettingsPresets, settingsPreset } from "./settings-presets";
import { evaluateConstraints } from "./settings-constraints";
import {
  getSettings, AI_PROVIDERS, STT_PROVIDERS, FX_RATE_POLICIES, type SettingsState,
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
