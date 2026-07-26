import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEvm } from "./evm";

/**
 * EVM engine: derives the full variance + forecast picture from PV/EV/AC/BAC. Canonical PMBOK vector plus the
 * divide-by-zero edges (no cost yet, nothing scheduled) that must yield null, never NaN/Infinity.
 */

// Canonical: BAC 1000, PV 500, EV 400, AC 500 — behind schedule AND over budget (CPI=SPI=0.8).
const CANON = { plannedValue: 500, earnedValue: 400, actualCost: 500, budgetAtCompletion: 1000 };

test("canonical vector: variances, indices, progress", () => {
  const e = computeEvm(CANON);
  assert.equal(e.costVariance, -100); // EV−AC
  assert.equal(e.scheduleVariance, -100); // EV−PV
  assert.equal(e.costPerformanceIndex, 0.8); // EV/AC
  assert.equal(e.schedulePerformanceIndex, 0.8); // EV/PV
  assert.equal(e.percentComplete, 0.4); // EV/BAC
  assert.equal(e.percentSpent, 0.5); // AC/BAC
  assert.equal(e.costVariancePct, -0.25); // CV/EV
  assert.equal(e.scheduleVariancePct, -0.2); // SV/PV
});

test("canonical vector: EAC variants, ETC, VAC, TCPI", () => {
  const e = computeEvm(CANON);
  assert.equal(e.eacVariants.cpi, 1250); // BAC/CPI = 1000/0.8
  assert.equal(e.eacVariants.budgetRate, 1100); // AC+(BAC−EV) = 500+600
  assert.equal(e.eacVariants.cpiSpi, 1437.5); // AC+(BAC−EV)/(CPI·SPI) = 500+600/0.64
  // Headline defaults to the CPI method.
  assert.equal(e.eacMethod, "cpi");
  assert.equal(e.estimateAtCompletion, 1250);
  assert.equal(e.estimateToComplete, 750); // EAC−AC
  assert.equal(e.varianceAtCompletion, -250); // BAC−EAC
  assert.equal(e.toCompletePerformanceIndex, 1.2); // (BAC−EV)/(BAC−AC) = 600/500
  assert.equal(e.toCompletePerformanceIndexToEac, 0.8); // (BAC−EV)/(EAC−AC) = 600/750
});

test("eacMethod selects the headline forecast", () => {
  assert.equal(computeEvm({ ...CANON, eacMethod: "budget_rate" }).estimateAtCompletion, 1100);
  assert.equal(computeEvm({ ...CANON, eacMethod: "cpi_spi" }).estimateAtCompletion, 1437.5);
  // etc method needs a supplied ETC.
  const withEtc = computeEvm({ ...CANON, eacMethod: "etc", estimateToComplete: 700 });
  assert.equal(withEtc.estimateAtCompletion, 1200); // AC+ETC = 500+700
  assert.equal(withEtc.varianceAtCompletion, -200);
  // etc method with no ETC supplied → null headline (but other variants still compute).
  const noEtc = computeEvm({ ...CANON, eacMethod: "etc" });
  assert.equal(noEtc.estimateAtCompletion, null);
  assert.equal(noEtc.eacVariants.cpi, 1250);
});

test("on budget and on schedule → unit indices, zero variance, EAC = BAC", () => {
  const e = computeEvm({ plannedValue: 500, earnedValue: 500, actualCost: 500, budgetAtCompletion: 1000 });
  assert.equal(e.costPerformanceIndex, 1);
  assert.equal(e.schedulePerformanceIndex, 1);
  assert.equal(e.costVariance, 0);
  assert.equal(e.scheduleVariance, 0);
  assert.equal(e.estimateAtCompletion, 1000); // BAC/1
  assert.equal(e.varianceAtCompletion, 0);
  assert.equal(e.toCompletePerformanceIndex, 1); // (BAC−EV)/(BAC−AC) = 500/500
});

test("no cost booked yet (AC=0) → CPI/CPI-EAC null, but schedule + budget-rate still compute", () => {
  const e = computeEvm({ plannedValue: 200, earnedValue: 100, actualCost: 0, budgetAtCompletion: 1000 });
  assert.equal(e.costPerformanceIndex, null); // EV/0
  assert.equal(e.eacVariants.cpi, null); // BAC/CPI undefined
  assert.equal(e.estimateAtCompletion, null); // headline (cpi) undefined
  assert.equal(e.schedulePerformanceIndex, 0.5); // EV/PV still fine
  assert.equal(e.eacVariants.budgetRate, 900); // AC+(BAC−EV) = 0+900
  assert.equal(e.toCompletePerformanceIndex, 0.9); // (1000−100)/(1000−0)
});

test("nothing scheduled (PV=0) → SPI null; no divide-by-zero leaks", () => {
  const e = computeEvm({ plannedValue: 0, earnedValue: 100, actualCost: 120, budgetAtCompletion: 1000 });
  assert.equal(e.schedulePerformanceIndex, null);
  assert.equal(e.scheduleVariancePct, null);
  // Every numeric field is either a finite number or null — never NaN/Infinity.
  for (const [k, v] of Object.entries(e)) {
    if (typeof v === "number") assert.ok(Number.isFinite(v), `${k} must be finite`);
  }
});

test("TCPI-to-BAC guards the fully-spent case (BAC=AC) → null", () => {
  const e = computeEvm({ plannedValue: 1000, earnedValue: 900, actualCost: 1000, budgetAtCompletion: 1000 });
  assert.equal(e.toCompletePerformanceIndex, null); // (BAC−EV)/(BAC−AC) = 100/0
});
