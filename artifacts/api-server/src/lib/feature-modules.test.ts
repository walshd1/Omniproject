import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { FEATURE_MODULES, isFeatureEnabled, featureStatus, requireFeature } from "./feature-modules";
import { updateSettings } from "./settings";

afterEach(() => {
  updateSettings({ disabledFeatures: [] }); // reset the shared in-memory store between tests
});

test("every registered module is enabled by default (opt-out model)", () => {
  updateSettings({ disabledFeatures: [] });
  for (const m of FEATURE_MODULES) assert.equal(isFeatureEnabled(m.id), true);
});

test("disabling a module via settings flips isFeatureEnabled", () => {
  assert.ok(FEATURE_MODULES.length > 0);
  const id = FEATURE_MODULES[0]!.id;
  updateSettings({ disabledFeatures: [id] });
  assert.equal(isFeatureEnabled(id), false);
  // other modules stay enabled
  for (const m of FEATURE_MODULES.slice(1)) assert.equal(isFeatureEnabled(m.id), true);
});

test("a UI-only module (no backend route) is enabled by default and never needsRestart", () => {
  updateSettings({ disabledFeatures: [] });
  const grid = featureStatus().find((s) => s.id === "grid");
  assert.ok(grid, "the grid UI-only module is registered");
  assert.equal(grid!.enabled, true);
  assert.equal(grid!.loaded, true); // UI-only modules are 'live' client-side when enabled
  assert.equal(grid!.needsRestart, false); // no backend chunk to load → never needs a restart
});

test("featureStatus reflects the enabled flag per module", () => {
  const id = FEATURE_MODULES[0]!.id;
  updateSettings({ disabledFeatures: [id] });
  const status = featureStatus();
  assert.equal(status.length, FEATURE_MODULES.length);
  const row = status.find((s) => s.id === id)!;
  assert.equal(row.enabled, false);
  assert.ok(row.label && row.description);
});

test("requireFeature calls next when enabled and 404s when disabled", () => {
  const id = FEATURE_MODULES[0]!.id;
  const mw = requireFeature(id);

  // enabled → next()
  updateSettings({ disabledFeatures: [] });
  let nexted = false;
  mw({} as never, makeRes() as never, () => { nexted = true; });
  assert.equal(nexted, true);

  // disabled → 404, no next()
  updateSettings({ disabledFeatures: [id] });
  let nexted2 = false;
  const res = makeRes();
  mw({} as never, res as never, () => { nexted2 = true; });
  assert.equal(nexted2, false);
  assert.equal(res.statusCode, 404);
});

/** Minimal Express-ish response capturing status()/json(). */
function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res as typeof res & Record<string, unknown>;
}
