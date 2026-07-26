import { test } from "node:test";
import assert from "node:assert/strict";
import { evmForRollup } from "./portfolio-financials";

/**
 * evmForRollup — the pure map from a consolidated finance roll-up to the EVM picture. No broker/I/O, so
 * it is unit-tested directly (the HTTP shape is covered by portfolio-financials-routes.test.ts). Uses
 * the EVM engine's canonical intuition: BAC = budget, EV = earnedValue, AC = actual, PV = plannedValue.
 */

test("full EVM: with PV supplied, CPI/SPI and the headline EAC surface", () => {
  // Canonical PMBOK vector: BAC 1000, PV 500, EV 400, AC 500 → CPI = SPI = 0.8, EAC = 1250.
  const evm = evmForRollup({ budget: 1000, earnedValue: 400, actual: 500, plannedValue: 500 });
  assert.ok(evm);
  assert.equal(evm!.costPerformanceIndex, 0.8); // EV/AC
  assert.equal(evm!.schedulePerformanceIndex, 0.8); // EV/PV — needs PV
  assert.equal(evm!.estimateAtCompletion, 1250); // BAC/CPI
  assert.equal(evm!.varianceAtCompletion, -250); // BAC − EAC
});

test("cost-only EVM: without PV, CPI still computes but SPI/schedule variance are null", () => {
  const evm = evmForRollup({ budget: 1000, earnedValue: 400, actual: 500, plannedValue: 0 });
  assert.ok(evm);
  assert.equal(evm!.costPerformanceIndex, 0.8); // EV/AC unaffected
  assert.equal(evm!.schedulePerformanceIndex, null); // EV/0 guarded
  assert.equal(evm!.scheduleVariancePct, null);
});

test("no financials at all ⇒ null (renders as — rather than a bogus zero forecast)", () => {
  assert.equal(evmForRollup({ budget: 0, earnedValue: 0, actual: 0, plannedValue: 0 }), null);
});

test("a lone non-zero primitive still yields an EVM object (not null)", () => {
  const evm = evmForRollup({ budget: 500, earnedValue: 0, actual: 0, plannedValue: 0 });
  assert.ok(evm);
  assert.equal(evm!.budgetAtCompletion, 500);
  assert.equal(evm!.percentComplete, 0); // EV/BAC = 0
});
