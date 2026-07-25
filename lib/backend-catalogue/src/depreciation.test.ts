import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMonths,
  depreciableBase,
  depreciationSchedule,
  depreciationForPeriod,
  depreciationJournal,
  disposalResult,
  disposalJournal,
  DepreciationError,
  type DepreciableAsset,
  type JournalEntryPayload,
} from "./depreciation";

/**
 * The fixed-asset depreciation engine — pure schedule generation + balanced GL journals over the F20
 * `fixed_asset` register. Every schedule must sum to the depreciable base (rounded, no drift) and land NBV on
 * salvage; every journal must balance to the cent.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (ns: number[]) => round2(ns.reduce((s, n) => s + n, 0));
/** Assert a journal entry balances (Σ debit === Σ credit) to the cent. */
function assertBalanced(j: JournalEntryPayload) {
  const debit = sum(j.lines.map((l) => l.debit));
  const credit = sum(j.lines.map((l) => l.credit));
  assert.equal(debit, credit, `journal must balance: debit ${debit} !== credit ${credit}`);
  assert.ok(debit > 0, "a posted journal must move money");
}

const SL: DepreciableAsset = { acquisitionCost: 12000, salvageValue: 2000, usefulLifeMonths: 10, depreciationMethod: "straight_line", inServiceDate: "2024-01-31" };

test("addMonths advances UTC months, clamping to the shortest target month", () => {
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29"); // leap Feb
  assert.equal(addMonths("2023-01-31", 1), "2023-02-28"); // non-leap Feb
  assert.equal(addMonths("2024-12-15", 1), "2025-01-15"); // year rollover
  assert.equal(addMonths("2024-01-15", 12), "2025-01-15");
  assert.equal(addMonths("2024-03-31", 1), "2024-04-30"); // 31 → 30-day month
  assert.throws(() => addMonths("not-a-date", 1), DepreciationError);
});

test("depreciableBase is cost − salvage, never negative", () => {
  assert.equal(depreciableBase(SL), 10000);
  assert.equal(depreciableBase({ ...SL, salvageValue: 20000 }), 0); // salvage > cost ⇒ 0, not negative
});

test("straight_line spreads the base evenly; sums to base; NBV lands on salvage", () => {
  const sched = depreciationSchedule(SL);
  assert.equal(sched.length, 10);
  for (const p of sched) assert.equal(p.depreciation, 1000);
  assert.equal(sum(sched.map((p) => p.depreciation)), 10000);
  assert.equal(sched.at(-1)!.accumulatedDepreciation, 10000);
  assert.equal(sched.at(-1)!.netBookValue, 2000); // == salvage
  assert.equal(sched[0]!.periodDate, "2024-02-29"); // in-service + 1 month, clamped
});

test("straight_line trues up the last period so rounded periods sum exactly to base", () => {
  // 10000 / 3 = 3333.33… — the last period absorbs the residual.
  const sched = depreciationSchedule({ ...SL, salvageValue: 0, usefulLifeMonths: 3, acquisitionCost: 10000 });
  assert.deepEqual(sched.map((p) => p.depreciation), [3333.33, 3333.33, 3333.34]);
  assert.equal(sum(sched.map((p) => p.depreciation)), 10000);
});

test("declining_balance is accelerated, switches to straight-line, and converges to salvage", () => {
  const sched = depreciationSchedule({ acquisitionCost: 10000, salvageValue: 0, usefulLifeMonths: 5, depreciationMethod: "declining_balance", inServiceDate: "2024-01-01" });
  assert.deepEqual(sched.map((p) => p.depreciation), [4000, 2400, 1440, 1080, 1080]);
  assert.ok(sched[0]!.depreciation > sched[1]!.depreciation, "front-loaded");
  assert.equal(sum(sched.map((p) => p.depreciation)), 10000);
  assert.equal(sched.at(-1)!.netBookValue, 0);
});

test("declining_balance never depreciates below salvage", () => {
  const sched = depreciationSchedule({ acquisitionCost: 10000, salvageValue: 3000, usefulLifeMonths: 5, depreciationMethod: "declining_balance", inServiceDate: "2024-01-01" });
  assert.equal(sum(sched.map((p) => p.depreciation)), 7000); // base = cost − salvage
  for (const p of sched) assert.ok(p.netBookValue >= 3000 - 0.001, `NBV ${p.netBookValue} must not dip below salvage`);
  assert.equal(sched.at(-1)!.netBookValue, 3000);
});

test("sum_of_years_digits weights period k by (n−k+1)/Σ and sums to base", () => {
  const sched = depreciationSchedule({ acquisitionCost: 10000, salvageValue: 1000, usefulLifeMonths: 4, depreciationMethod: "sum_of_years_digits", inServiceDate: "2024-01-01" });
  assert.deepEqual(sched.map((p) => p.depreciation), [3600, 2700, 1800, 900]);
  assert.equal(sum(sched.map((p) => p.depreciation)), 9000);
  assert.equal(sched.at(-1)!.netBookValue, 1000);
});

test("units_of_production is usage-proportional and caps at the base on overrun", () => {
  const asset: DepreciableAsset = { acquisitionCost: 11000, salvageValue: 1000, usefulLifeMonths: 0, depreciationMethod: "units_of_production", inServiceDate: "2024-01-01" };
  const sched = depreciationSchedule(asset, { units: [100, 200, 300, 400], totalUnits: 1000 });
  assert.deepEqual(sched.map((p) => p.depreciation), [1000, 2000, 3000, 4000]);
  assert.equal(sum(sched.map((p) => p.depreciation)), 10000);
  // Overrun: reported units exceed the estimate — never recognise past the base.
  const over = depreciationSchedule(asset, { units: [600, 600], totalUnits: 1000 });
  assert.deepEqual(over.map((p) => p.depreciation), [6000, 4000]);
  assert.equal(sum(over.map((p) => p.depreciation)), 10000);
});

test("units_of_production without a usage series is a clear error", () => {
  const asset: DepreciableAsset = { acquisitionCost: 11000, usefulLifeMonths: 0, depreciationMethod: "units_of_production", inServiceDate: "2024-01-01" };
  assert.throws(() => depreciationSchedule(asset), DepreciationError);
  assert.throws(() => depreciationSchedule(asset, { units: [1, 2] }), DepreciationError); // no totalUnits
});

test("an asset onboarded mid-life continues from its opening accumulated depreciation", () => {
  const sched = depreciationSchedule({ ...SL, accumulatedDepreciation: 4000 });
  assert.equal(sched[0]!.accumulatedDepreciation, 5000); // 4000 opening + 1000 period 1
  assert.equal(sched[0]!.netBookValue, 7000); // 12000 − 5000
});

test("invalid life / unknown method throw DepreciationError", () => {
  assert.throws(() => depreciationSchedule({ ...SL, usefulLifeMonths: 0 }), DepreciationError);
  assert.throws(() => depreciationSchedule({ ...SL, depreciationMethod: "nonsense" as never }), DepreciationError);
});

test("a fully-salvage asset depreciates nothing but still schedules its periods", () => {
  const sched = depreciationSchedule({ ...SL, salvageValue: 12000 });
  assert.equal(sched.length, 10);
  assert.equal(sum(sched.map((p) => p.depreciation)), 0);
  assert.equal(sched.at(-1)!.netBookValue, 12000);
});

test("depreciationForPeriod returns the amount for a matching posting date, else 0", () => {
  assert.equal(depreciationForPeriod(SL, "2024-02-29"), 1000);
  assert.equal(depreciationForPeriod(SL, "2099-01-01"), 0);
});

test("depreciationJournal posts Dr expense / Cr accumulated and balances; zero ⇒ null", () => {
  const sched = depreciationSchedule(SL);
  const j = depreciationJournal(sched[0]!, { expenseAccount: "6800", accumulatedAccount: "1590" })!;
  assert.equal(j.journalDate, "2024-02-29");
  assert.deepEqual(j.lines, [
    { account: "6800", debit: 1000, credit: 0, memo: "Depreciation period 1" },
    { account: "1590", debit: 0, credit: 1000, memo: "Depreciation period 1" },
  ]);
  assertBalanced(j);
  // A zero-depreciation period posts nothing.
  const zero = depreciationSchedule({ ...SL, salvageValue: 12000 });
  assert.equal(depreciationJournal(zero[0]!, { expenseAccount: "6800", accumulatedAccount: "1590" }), null);
});

test("disposalResult computes carrying value (incl. impairment) and gain/loss", () => {
  const r = disposalResult({ acquisitionCost: 10000, accumulatedDepreciation: 7000, impairmentLoss: 500, disposalProceeds: 4000 });
  assert.equal(r.netBookValue, 2500);
  assert.equal(r.gainLoss, 1500);
  assert.ok(r.isGain && !r.isLoss);
  const loss = disposalResult({ acquisitionCost: 10000, accumulatedDepreciation: 7000, impairmentLoss: 500, disposalProceeds: 1000 });
  assert.equal(loss.gainLoss, -1500);
  assert.ok(loss.isLoss && !loss.isGain);
});

test("disposalJournal balances on a gain and on a loss", () => {
  const accounts = { assetAccount: "1500", accumulatedAccount: "1590", proceedsAccount: "1010", gainLossAccount: "7400" };
  const gain = disposalJournal({ acquisitionCost: 10000, accumulatedDepreciation: 7000, impairmentLoss: 500, disposalProceeds: 4000, disposalDate: "2024-06-30" }, accounts);
  assert.equal(gain.journalDate, "2024-06-30");
  assertBalanced(gain);
  assert.ok(gain.lines.some((l) => l.account === "7400" && l.credit === 1500), "gain is credited");

  const loss = disposalJournal({ acquisitionCost: 10000, accumulatedDepreciation: 7000, impairmentLoss: 500, disposalProceeds: 1000, disposalDate: "2024-06-30" }, accounts);
  assertBalanced(loss);
  assert.ok(loss.lines.some((l) => l.account === "7400" && l.debit === 1500), "loss is debited");
});

test("a fully-depreciated asset scrapped for nothing balances (write-off)", () => {
  const accounts = { assetAccount: "1500", accumulatedAccount: "1590", proceedsAccount: "1010", gainLossAccount: "7400" };
  const j = disposalJournal({ acquisitionCost: 8000, accumulatedDepreciation: 8000, disposalProceeds: 0, disposalDate: "2024-06-30" }, accounts);
  assertBalanced(j); // Dr accumulated 8000 / Cr asset 8000, no gain/loss
  assert.equal(j.lines.length, 2);
});
