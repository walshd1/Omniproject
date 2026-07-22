import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBudgetPlans, BudgetPlanError } from "./budget-plan";

/**
 * Budget-plan currency default (re-land of pass-2 P2). A plan that omits `currency` must fall back to the
 * deployment's reporting currency (passed in by settings), not a hard-coded GBP — otherwise a USD/EUR
 * enterprise silently mis-labels every plan. When no reporting currency is set, GBP is the last resort.
 */

const plan = (currency?: string) => ({ id: "b1", projectId: "p1", ...(currency ? { currency } : {}), periods: [{ period: "2026", amount: 100 }] });

test("an omitted currency falls back to the deployment reporting currency", () => {
  assert.equal(validateBudgetPlans([plan()], "USD")[0]!.currency, "USD");
  assert.equal(validateBudgetPlans([plan()], "EUR")[0]!.currency, "EUR");
});

test("an omitted currency with no reporting currency falls back to GBP", () => {
  assert.equal(validateBudgetPlans([plan()])[0]!.currency, "GBP");
  assert.equal(validateBudgetPlans([plan()], "")[0]!.currency, "GBP");
});

test("an explicit currency is never overridden by the default", () => {
  assert.equal(validateBudgetPlans([plan("JPY")], "USD")[0]!.currency, "JPY");
});

test("a non-array is rejected", () => {
  assert.throws(() => validateBudgetPlans({}, "USD"), BudgetPlanError);
});
