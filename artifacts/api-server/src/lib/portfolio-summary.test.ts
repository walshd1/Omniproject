import { test } from "node:test";
import assert from "node:assert/strict";
import type { PortfolioRow } from "../broker";
import { summarizeHealth, foldFinance, foldCapacity } from "./portfolio-summary";

function row(partial: Partial<PortfolioRow>): PortfolioRow {
  return {
    projectId: "p", projectName: "P", ragStatus: "GREEN", scheduleVarianceDays: 0,
    budgetVariancePercentage: 0, activeBlockersCount: 0, ...partial,
  };
}

test("summarizeHealth: counts RAG statuses and averages variances, case-insensitively", () => {
  const rows = [
    row({ ragStatus: "GREEN", scheduleVarianceDays: 2, budgetVariancePercentage: 5, activeBlockersCount: 1 }),
    row({ ragStatus: "amber", scheduleVarianceDays: -4, budgetVariancePercentage: -10, activeBlockersCount: 2 }),
    row({ ragStatus: "Red", scheduleVarianceDays: 10, budgetVariancePercentage: 20, activeBlockersCount: 3 }),
  ];
  const s = summarizeHealth(rows);
  assert.equal(s.projects, 3);
  assert.deepEqual(s.rag, { green: 1, amber: 1, red: 1, other: 0 });
  assert.equal(s.avgScheduleVarianceDays, Math.round(((2 - 4 + 10) / 3) * 10) / 10);
  assert.equal(s.avgBudgetVariancePercentage, Math.round(((5 - 10 + 20) / 3) * 10) / 10);
  assert.equal(s.totalActiveBlockers, 6);
});

test("summarizeHealth: an unrecognised ragStatus falls into 'other', never dropped or thrown", () => {
  const s = summarizeHealth([row({ ragStatus: "purple" }), row({ ragStatus: "" })]);
  assert.deepEqual(s.rag, { green: 0, amber: 0, red: 0, other: 2 });
});

test("summarizeHealth: no rows ⇒ null averages, not NaN or a throw", () => {
  const s = summarizeHealth([]);
  assert.equal(s.projects, 0);
  assert.equal(s.avgScheduleVarianceDays, null);
  assert.equal(s.avgBudgetVariancePercentage, null);
  assert.equal(s.totalActiveBlockers, 0);
});

// ── foldFinance ────────────────────────────────────────────────────────────────

test("foldFinance: converts each project's currency into the target and sums to a portfolio total", () => {
  const rates = { GBP: 1, USD: 0.8, EUR: 0.85 };
  const rows = [
    { currency: "GBP", budgetAllocated: 100, actualBurn: 50, forecastCostAtCompletion: 90, earnedValue: 40 },
    { currency: "USD", budgetAllocated: 100, actualBurn: 50, forecastCostAtCompletion: 90, earnedValue: 40 }, // → GBP: *0.8
  ];
  const { totals, includedRows, droppedForFx } = foldFinance(rows, "GBP", rates);
  assert.equal(totals.currency, "GBP");
  assert.equal(totals.budget, 100 + 100 * 0.8);
  assert.equal(totals.actual, 50 + 50 * 0.8);
  assert.equal(totals.variance, totals.budget - totals.forecast);
  assert.equal(totals.cpi, Math.round((totals.earnedValue / totals.actual) * 100) / 100);
  assert.equal(includedRows, 2);
  assert.equal(droppedForFx, 0);
});

test("foldFinance: EXCLUDES a row whose currency has no FX rate — never sums a raw foreign amount", () => {
  // ₩-style unconvertible currency must not be added into a GBP total as if it were GBP.
  const { totals, includedRows, droppedForFx } = foldFinance(
    [{ currency: "ZZZ", budgetAllocated: 100, actualBurn: 0, forecastCostAtCompletion: 0, earnedValue: 0 }],
    "GBP",
    { GBP: 1 },
  );
  assert.equal(totals.budget, 0); // dropped, NOT mixed in as 100 GBP
  assert.equal(droppedForFx, 1);
  assert.equal(includedRows, 0);
});

test("foldFinance: target-currency rows fold correctly even with no rate table at all", () => {
  // FX fetch failed (rates undefined) — same-currency rows need no conversion and must still sum.
  const { totals, includedRows, droppedForFx } = foldFinance(
    [{ currency: "GBP", budgetAllocated: 100, actualBurn: 40, forecastCostAtCompletion: 90, earnedValue: 30 }],
    "GBP",
    undefined,
  );
  assert.equal(totals.budget, 100);
  assert.equal(includedRows, 1);
  assert.equal(droppedForFx, 0);
});

test("foldFinance: a dirty amount (string/null/NaN) coerces to 0 instead of poisoning the total", () => {
  const rows = [{ currency: "GBP", budgetAllocated: "not-a-number", actualBurn: null, forecastCostAtCompletion: undefined, earnedValue: 0 }];
  const { totals } = foldFinance(rows, "GBP");
  assert.equal(totals.budget, 0);
  assert.equal(totals.actual, 0);
  assert.ok(Number.isFinite(totals.variance));
});

test("foldFinance: cpi is null when there's no spend yet", () => {
  const { totals } = foldFinance([{ currency: "GBP", budgetAllocated: 100, actualBurn: 0, forecastCostAtCompletion: 100, earnedValue: 0 }], "GBP");
  assert.equal(totals.cpi, null);
});

// ── foldCapacity ───────────────────────────────────────────────────────────────

test("foldCapacity: sums hours, counts over-allocations, and computes utilisation", () => {
  const rows = [
    { allocationPercentage: 120, assignedHours: 40, availableHours: 40 },
    { allocationPercentage: 50, assignedHours: 20, availableHours: 40 },
  ];
  const totals = foldCapacity(rows);
  assert.equal(totals.allocations, 2);
  assert.equal(totals.overAllocated, 1);
  assert.equal(totals.assignedHours, 60);
  assert.equal(totals.availableHours, 80);
  assert.equal(totals.utilisation, 75); // 60/80 * 100
});

test("foldCapacity: utilisation is null when there's no declared availability", () => {
  const totals = foldCapacity([{ allocationPercentage: 100, assignedHours: 10, availableHours: 0 }]);
  assert.equal(totals.utilisation, null);
});
