import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveScopedSettings } from "./settings-scope";
import { getSettings } from "./settings";

test("resolveScopedSettings with no scope returns the base settings unchanged", () => {
  const base = getSettings();
  const eff = resolveScopedSettings(base, {});
  assert.equal(eff.reportingCurrency, base.reportingCurrency);
  assert.equal(eff.fxRatePolicy, base.fxRatePolicy);
  assert.deepEqual(eff.priorityWeights, base.priorityWeights);
  // A non-scope-variable key is carried through as-is.
  assert.equal(eff.deploymentProfile, base.deploymentProfile);
});
