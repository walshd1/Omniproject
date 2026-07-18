import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateConstraints, type FieldLock } from "./settings-constraints";
import { getSettings, updateSettings, SettingsValidationError, type SettingsState } from "./settings";

/**
 * Cross-field settings-incompatibility registry: illegal COMBINATIONS are prevented, and the inert-field
 * locks are surfaced so the admin UI can grey out incompatible controls.
 */

/** Build a full effective SettingsState from the live store with overrides, for pure-rule testing. */
function withSettings(over: Partial<SettingsState>): SettingsState {
  return { ...getSettings(), ...over } as SettingsState;
}
const lockPaths = (locks: FieldLock[]) => locks.map((l) => l.path).sort();

test("no reporting currency ⇒ FX policy + as-of date are locked (inert)", () => {
  const { locks, violations } = evaluateConstraints(withSettings({ reportingCurrency: null }));
  assert.deepEqual(violations, []); // inert, not illegal
  assert.ok(lockPaths(locks).includes("fxRatePolicy"));
  assert.ok(lockPaths(locks).includes("fxRateAsOfDate"));
});

test("spot FX policy ⇒ as-of date is locked; a non-spot policy leaves it free", () => {
  const spot = evaluateConstraints(withSettings({ reportingCurrency: "GBP", fxRatePolicy: "spot", fxRateAsOfDate: null }));
  assert.ok(lockPaths(spot.locks).includes("fxRateAsOfDate"));
  const periodClose = evaluateConstraints(withSettings({ reportingCurrency: "GBP", fxRatePolicy: "periodClose", fxRateAsOfDate: "2026-01-01" }));
  assert.ok(!lockPaths(periodClose.locks).includes("fxRateAsOfDate"));
});

test("no AI provider ⇒ aiModel is forced to null (locked)", () => {
  const { locks } = evaluateConstraints(withSettings({ aiProvider: "none" }));
  const modelLock = locks.find((l) => l.path === "aiModel");
  assert.ok(modelLock);
  assert.equal(modelLock!.state, "forced");
  assert.equal(modelLock!.forcedValue, null);
});

test("a feature both enabled and disabled is a hard violation", () => {
  const { violations } = evaluateConstraints(withSettings({ enabledFeatures: ["odata"], disabledFeatures: ["odata"] }));
  assert.equal(violations.length, 1);
  assert.match(violations[0]!.message, /can't be both enabled and disabled/);
});

test("selfHost mode is locked until its acknowledgement is given", () => {
  // (loggingSync's enable lock left settings-constraints with the `logging-sync` config def — Phase C; its
  //  url + warranty-ack gate is enforced by the route validator + the panel's local guard.)
  const { locks } = evaluateConstraints(withSettings({
    selfHost: { mode: "off", adopted: [], acknowledgedDataResponsibility: false },
  }));
  assert.ok(lockPaths(locks).includes("selfHost.mode"));
});

test("updateSettings REJECTS an enabled∩disabled feature combination (server enforcement)", () => {
  assert.throws(
    () => updateSettings({ enabledFeatures: ["reports"], disabledFeatures: ["reports"] }),
    (e) => e instanceof SettingsValidationError && /can't be both enabled and disabled/.test((e as Error).message),
  );
});
