import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePresets, resolvePreset, presetConfigValues } from "./preset-config";

/**
 * Preset resolution from the scope-layered config. With no store, the resolver falls back to the shipped base
 * (`presetConfigValues`), so the shipped presets always resolve; org overrides fold on top through the same
 * `resolveConfig` seam the routes exercise end-to-end (presets-routes.test).
 */

test("resolvePresets returns the shipped presets from the base (store off ⇒ code fallback)", () => {
  const ids = resolvePresets().map((p) => p.id);
  assert.ok(ids.includes("scrum-team"), "scrum-team resolves");
  assert.ok(ids.includes("enterprise-scrum"), "enterprise-scrum resolves");
  // Ordered by `order`.
  assert.ok(resolvePresets().every((p, i, a) => i === 0 || a[i - 1]!.order <= p.order));
});

test("resolvePreset looks one up; unknown → undefined", () => {
  assert.equal(resolvePreset("scrum-team")?.methodology, "scrum");
  assert.equal(resolvePreset("ghost"), undefined);
});

test("the seeded config values wrap the shipped presets under a `list` key (the base layer)", () => {
  const values = presetConfigValues();
  assert.ok(Array.isArray(values.list));
  assert.ok(values.list.some((p) => p.id === "scrum-team"));
});
