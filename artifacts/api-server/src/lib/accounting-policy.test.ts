import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ACCOUNTING, sanitizeAccountingValues, foldAccounting,
  depreciationAccounts, disposalAccounts, missingAccountingAccounts,
  type AccountingConfig,
} from "./accounting-policy";

/**
 * Accounting policy — the pure type + validation + fold layer the ruleset governance composes. Account codes are
 * id-safe (or "" to unset); the DB factor is bounded; the fold is plain OVERRIDE (nearest wins), unlike the rule
 * modes' tighten-only fold.
 */

const FULL: AccountingConfig = {
  accounts: { depreciationExpense: "6800", accumulatedDepreciation: "1590", assetCost: "1500", disposalProceeds: "1010", gainLossOnDisposal: "7400" },
  decliningBalanceFactor: 2,
  defaultDepreciationMethod: "straight_line",
};

test("sanitizeAccountingValues validates codes + policy (partial), rejecting bad input", () => {
  assert.deepEqual(sanitizeAccountingValues({ accounts: { depreciationExpense: " 6800 " } }), { accounts: { depreciationExpense: "6800" } });
  assert.deepEqual(sanitizeAccountingValues({ decliningBalanceFactor: 1.5 }), { decliningBalanceFactor: 1.5 });
  assert.deepEqual(sanitizeAccountingValues({ defaultDepreciationMethod: "declining_balance" }), { defaultDepreciationMethod: "declining_balance" });
  assert.deepEqual(sanitizeAccountingValues({ accounts: { assetCost: "" } }), { accounts: { assetCost: "" } }); // "" clears a code
  assert.throws(() => sanitizeAccountingValues({ accounts: { depreciationExpense: "has space" } }), /account code/);
  assert.throws(() => sanitizeAccountingValues({ decliningBalanceFactor: 0.5 }), /decliningBalanceFactor/);
  assert.throws(() => sanitizeAccountingValues({ decliningBalanceFactor: 5 }), /decliningBalanceFactor/);
  assert.throws(() => sanitizeAccountingValues({ defaultDepreciationMethod: "nonsense" }), /depreciation method/);
});

test("foldAccounting OVERRIDES (nearest wins): each supplied code/factor replaces, absent keys inherit", () => {
  const eff = foldAccounting(DEFAULT_ACCOUNTING, { accounts: { depreciationExpense: "6800", accumulatedDepreciation: "1590" }, decliningBalanceFactor: 1.5 });
  assert.equal(eff.accounts.depreciationExpense, "6800");
  assert.equal(eff.accounts.accumulatedDepreciation, "1590");
  assert.equal(eff.accounts.assetCost, ""); // untouched key keeps the base default
  assert.equal(eff.decliningBalanceFactor, 1.5);
  assert.equal(eff.defaultDepreciationMethod, "straight_line"); // not overridden ⇒ base
  // A second fold (a nearer scope) overrides the factor again — nearest wins, not tighten.
  assert.equal(foldAccounting(eff, { decliningBalanceFactor: 2 }).decliningBalanceFactor, 2);
  // Undefined override is a no-op copy (never mutates the base).
  assert.deepEqual(foldAccounting(FULL, undefined), FULL);
});

test("account mappers + missing-accounts report feed the depreciation engine", () => {
  assert.deepEqual(depreciationAccounts(FULL), { expenseAccount: "6800", accumulatedAccount: "1590" });
  assert.deepEqual(disposalAccounts(FULL), { assetAccount: "1500", accumulatedAccount: "1590", proceedsAccount: "1010", gainLossAccount: "7400" });
  assert.deepEqual(missingAccountingAccounts(FULL), []);
  assert.deepEqual(missingAccountingAccounts(DEFAULT_ACCOUNTING), ["depreciationExpense", "accumulatedDepreciation", "assetCost", "disposalProceeds", "gainLossOnDisposal"]);
});
