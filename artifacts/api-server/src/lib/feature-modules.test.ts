import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { FEATURE_MODULES, isFeatureEnabled, featureStatus, requireFeature, resolveScopedFeatures } from "./feature-modules";
import { updateSettings } from "./settings";

/** A stable default-ON module (e.g. grid) and a default-OFF one (e.g. presence) for the assertions. */
const ON_ID = FEATURE_MODULES.find((m) => !m.defaultOff)!.id;
const OFF_ID = FEATURE_MODULES.find((m) => m.defaultOff)!.id;

afterEach(() => {
  // Reset the shared in-memory store between tests.
  updateSettings({ disabledFeatures: [], enabledFeatures: [], featureGovernance: { required: [], forbidden: [] }, programmeFeatures: {}, projectFeatures: {} });
});

test("default-ON modules are enabled by default; default-OFF (cost/safety) ones are not", () => {
  for (const m of FEATURE_MODULES) {
    assert.equal(isFeatureEnabled(m.id), !m.defaultOff, `${m.id} should default to ${!m.defaultOff}`);
  }
});

test("an org opt-in enables a default-off feature", () => {
  assert.equal(isFeatureEnabled(OFF_ID), false);
  updateSettings({ enabledFeatures: [OFF_ID] });
  assert.equal(isFeatureEnabled(OFF_ID), true);
});

test("disabling a default-on module via settings flips isFeatureEnabled", () => {
  updateSettings({ disabledFeatures: [ON_ID] });
  assert.equal(isFeatureEnabled(ON_ID), false);
});

test("a UI-only module (grid) is enabled by default and never needsRestart", () => {
  const grid = featureStatus().find((s) => s.id === "grid");
  assert.ok(grid, "the grid UI-only module is registered");
  assert.equal(grid!.enabled, true);
  assert.equal(grid!.loaded, true); // UI-only modules are 'live' client-side when enabled
  assert.equal(grid!.needsRestart, false); // no backend chunk to load → never needs a restart
});

test("featureStatus surfaces defaultOff/reason + spans modules, reports and methodologies", () => {
  const status = featureStatus();
  assert.equal(status.filter((s) => s.kind === "module").length, FEATURE_MODULES.length);
  assert.ok(status.some((s) => s.kind === "report" && s.id.startsWith("report:")));
  assert.ok(status.some((s) => s.kind === "methodology" && s.id.startsWith("methodology:")));
  const off = status.find((s) => s.id === OFF_ID)!;
  assert.equal(off.defaultOff, true);
  assert.ok(off.reason); // a safety/cost/storage reason is recorded
  assert.equal(off.enabled, false);
});

test("a PMO can forbid a report through the same governance resolver", () => {
  updateSettings({ featureGovernance: { required: [], forbidden: ["report:evm"] } });
  const evm = featureStatus({ projectId: "p1" }).find((s) => s.id === "report:evm")!;
  assert.equal(evm.enabled, false);
  assert.equal(evm.lockedBy, "org");
  assert.equal(evm.policy, "forbid");
});

test("scoped resolution: a programme `forbid` disables a feature and reports the lock", () => {
  updateSettings({ programmeFeatures: { "prog-1": { disabled: [], required: [], forbidden: [ON_ID] } } });
  // org scope: still on
  assert.equal(isFeatureEnabled(ON_ID), true);
  // programme scope: forbidden + locked
  assert.equal(isFeatureEnabled(ON_ID, { programmeId: "prog-1" }), false);
  const row = resolveScopedFeatures({ programmeId: "prog-1" }).find((r) => r.id === ON_ID)!;
  assert.equal(row.locked, true);
  assert.equal(row.lockedBy, "programme");
  assert.equal(row.policy, "forbid");
});

test("scoped resolution: an org mandate forces a default-off feature on for every project", () => {
  updateSettings({ featureGovernance: { required: [OFF_ID], forbidden: [] } });
  assert.equal(isFeatureEnabled(OFF_ID, { projectId: "p1" }), true);
  const row = resolveScopedFeatures({ projectId: "p1" }).find((r) => r.id === OFF_ID)!;
  assert.equal(row.lockedBy, "org");
  assert.equal(row.policy, "require");
});

test("requireFeature calls next when enabled and 404s when disabled (scope-aware)", () => {
  const mw = requireFeature(ON_ID);

  // enabled at org scope → next()
  let nexted = false;
  mw({ params: {} } as never, makeRes() as never, () => { nexted = true; });
  assert.equal(nexted, true);

  // a project-scoped forbid → 404 when the request carries that projectId
  updateSettings({ projectFeatures: { p9: { disabled: [], required: [], forbidden: [ON_ID] } } });
  let nexted2 = false;
  const res = makeRes();
  mw({ params: { projectId: "p9" } } as never, res as never, () => { nexted2 = true; });
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
