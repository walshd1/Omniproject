import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMultiCurrencyEvm } from "./multi-currency-evm";

// Base-anchored table: convertAmount(amt, from, USD) = amt * rates[from] / rates[USD] = amt * rates[from].
const rates = { USD: 1, EUR: 1.1, GBP: 1.25 };

test("canonical: mixed-currency measures convert to base then compute EVM", () => {
  const r = computeMultiCurrencyEvm({
    plannedValue: [{ amount: 1000, currency: "USD" }],
    earnedValue: [{ amount: 1000, currency: "USD" }],
    actualCost: [{ amount: 400, currency: "USD" }, { amount: 320, currency: "GBP" }], // 400 + 400 = 800
    budgetAtCompletion: [{ amount: 1000, currency: "USD" }, { amount: 800, currency: "GBP" }], // 1000 + 1000 = 2000
    baseCurrency: "USD",
    rates,
  });
  assert.equal(r.baseCurrency, "USD");
  assert.equal(r.converted.actualCost, 800);
  assert.equal(r.converted.budgetAtCompletion, 2000);
  assert.equal(r.evm.costPerformanceIndex, 1.25); // EV/AC = 1000/800
  assert.equal(r.evm.estimateAtCompletion, 1600); // BAC/CPI = 2000/1.25
  assert.equal(r.evm.estimateToComplete, 800); // EAC − AC
  assert.equal(r.evm.varianceAtCompletion, 400); // BAC − EAC
  assert.equal(r.unconvertible.length, 0);
});

test("unconvertible lines are surfaced and excluded from the total, never summed raw", () => {
  const r = computeMultiCurrencyEvm({
    plannedValue: [],
    earnedValue: [],
    actualCost: [{ amount: 400, currency: "USD" }, { amount: 1000, currency: "JPY" }], // JPY absent from rates
    budgetAtCompletion: [],
    baseCurrency: "USD",
    rates,
  });
  assert.equal(r.converted.actualCost, 400); // the raw 1000 JPY is NOT added
  assert.deepEqual(r.unconvertible, [{ measure: "actualCost", amount: 1000, currency: "JPY" }]);
});

test("same-currency lines convert with no rate table (from === to short-circuit)", () => {
  const r = computeMultiCurrencyEvm({
    plannedValue: [],
    earnedValue: [{ amount: 300, currency: "USD" }],
    actualCost: [{ amount: 500, currency: "USD" }, { amount: 300, currency: "USD" }],
    budgetAtCompletion: [{ amount: 1000, currency: "USD" }],
    baseCurrency: "USD",
  });
  assert.equal(r.converted.actualCost, 800);
  assert.equal(r.converted.earnedValue, 300);
  assert.equal(r.unconvertible.length, 0);
});

test("baseCurrency defaults to GBP when unspecified", () => {
  const r = computeMultiCurrencyEvm({
    plannedValue: [], earnedValue: [], actualCost: [{ amount: 100, currency: "GBP" }], budgetAtCompletion: [],
  });
  assert.equal(r.baseCurrency, "GBP");
  assert.equal(r.converted.actualCost, 100);
});

test("empty inputs ⇒ zero totals; EVM ratios are guarded null; no ETC", () => {
  const r = computeMultiCurrencyEvm({ plannedValue: [], earnedValue: [], actualCost: [], budgetAtCompletion: [] });
  assert.equal(r.converted.plannedValue, 0);
  assert.equal(r.converted.actualCost, 0);
  assert.equal(r.converted.estimateToComplete, null);
  assert.equal(r.evm.costPerformanceIndex, null); // EV/AC with AC 0 ⇒ null, never NaN/Infinity
  assert.equal(r.evm.estimateAtCompletion, null);
  assert.deepEqual(r.currencyMix, []);
});

test("the 'etc' EAC method uses the converted estimate-to-complete total", () => {
  const r = computeMultiCurrencyEvm({
    plannedValue: [{ amount: 1000, currency: "USD" }],
    earnedValue: [{ amount: 1000, currency: "USD" }],
    actualCost: [{ amount: 800, currency: "USD" }],
    budgetAtCompletion: [{ amount: 2000, currency: "USD" }],
    estimateToComplete: [{ amount: 300, currency: "USD" }, { amount: 160, currency: "GBP" }], // 300 + 200 = 500
    baseCurrency: "USD",
    rates,
    eacMethod: "etc",
  });
  assert.equal(r.converted.estimateToComplete, 500);
  assert.equal(r.evm.estimateAtCompletion, 1300); // AC + ETC = 800 + 500
  assert.equal(r.evm.varianceAtCompletion, 700); // BAC − EAC = 2000 − 1300
});

test("currencyMix tallies distinct source currencies, most-common first", () => {
  const r = computeMultiCurrencyEvm({
    plannedValue: [{ amount: 1, currency: "USD" }],
    earnedValue: [{ amount: 1, currency: "USD" }, { amount: 1, currency: "EUR" }],
    actualCost: [{ amount: 1, currency: "USD" }, { amount: 1, currency: "EUR" }, { amount: 1, currency: "GBP" }],
    budgetAtCompletion: [],
    baseCurrency: "USD",
    rates,
  });
  assert.deepEqual(r.currencyMix, [
    { currency: "USD", count: 3 },
    { currency: "EUR", count: 2 },
    { currency: "GBP", count: 1 },
  ]);
});

test("dirty / non-finite amounts are coerced, never NaN", () => {
  const r = computeMultiCurrencyEvm({
    plannedValue: [],
    earnedValue: [],
    actualCost: [{ amount: "400" as unknown as number, currency: "USD" }, { amount: NaN as unknown as number, currency: "USD" }],
    budgetAtCompletion: [],
    baseCurrency: "USD",
    rates,
  });
  assert.equal(r.converted.actualCost, 400); // "400" → 400, NaN → 0
  assert.equal(Number.isNaN(r.converted.actualCost), false);
});
