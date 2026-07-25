import test from "node:test";
import assert from "node:assert/strict";
import { planDepreciationRun, type RunAsset } from "./depreciation-run";
import { DEFAULT_ACCOUNTING, type AccountingConfig } from "./accounting-policy";

/**
 * The depreciation period-run planner: idempotent, deterministic. It posts the schedule slice due in
 * (depreciationThroughDate, asOf], advances the marker, and is a no-op on a re-run.
 */

const ACCOUNTS: AccountingConfig = {
  ...DEFAULT_ACCOUNTING,
  accounts: { depreciationExpense: "6800", accumulatedDepreciation: "1590", assetCost: "1500", disposalProceeds: "1010", gainLossOnDisposal: "7400" },
};

// cost 12000, salvage 0, 12-month straight line ⇒ 1000/mo. In service 2024-01-31 ⇒ periods 2024-02-29, -03-31, -04-30, …
const ASSET: RunAsset = { id: "FA-1", assetNumber: "FA-1", acquisitionCost: 12000, salvageValue: 0, usefulLifeMonths: 12, depreciationMethod: "straight_line", inServiceDate: "2024-01-31", assetStatus: "in_service" };

const sum = (ns: number[]) => Math.round(ns.reduce((s, n) => s + n, 0) * 100) / 100;

test("posts every period due up to asOf, each journal balanced, and reports the write-back", () => {
  const plan = planDepreciationRun([ASSET], ACCOUNTS, "2024-04-30");
  assert.equal(plan.blockedNoAccounts, false);
  assert.deepEqual(plan.posts.map((p) => p.period), ["2024-02-29", "2024-03-31", "2024-04-30"]);
  assert.equal(sum(plan.posts.map((p) => p.amount)), 3000);
  for (const p of plan.posts) {
    const debit = sum(p.journal.lines.map((l) => l.debit));
    const credit = sum(p.journal.lines.map((l) => l.credit));
    assert.equal(debit, credit); // balanced
    assert.equal(p.journal.lines[0]!.account, "6800"); // Dr expense
    assert.equal(p.journal.lines[1]!.account, "1590"); // Cr accumulated
  }
  assert.deepEqual(plan.writebacks, [{ assetId: "FA-1", depreciationThroughDate: "2024-04-30", accumulatedDepreciation: 3000, netBookValue: 9000 }]);
});

test("idempotent: a re-run with the advanced marker posts nothing", () => {
  const done: RunAsset = { ...ASSET, depreciationThroughDate: "2024-04-30" };
  const plan = planDepreciationRun([done], ACCOUNTS, "2024-04-30");
  assert.equal(plan.posts.length, 0);
  assert.deepEqual(plan.skipped, [{ assetId: "FA-1", reason: "up to date" }]);
});

test("catch-up: only periods after the marker up to asOf are posted", () => {
  const partial: RunAsset = { ...ASSET, depreciationThroughDate: "2024-03-31" };
  const plan = planDepreciationRun([partial], ACCOUNTS, "2024-06-30");
  assert.deepEqual(plan.posts.map((p) => p.period), ["2024-04-30", "2024-05-31", "2024-06-30"]);
  assert.equal(plan.writebacks[0]!.depreciationThroughDate, "2024-06-30");
  assert.equal(plan.writebacks[0]!.accumulatedDepreciation, 5000); // period 5 (Feb=1 … Jun=5) cumulative
});

test("blocked when the depreciation GL accounts are unset — nothing posts, all skipped with a clear reason", () => {
  const plan = planDepreciationRun([ASSET], DEFAULT_ACCOUNTING, "2024-04-30");
  assert.equal(plan.blockedNoAccounts, true);
  assert.equal(plan.posts.length, 0);
  assert.match(plan.skipped[0]!.reason, /GL accounts are not set/);
});

test("skips assets that don't depreciate (disposed / no in-service date)", () => {
  const disposed: RunAsset = { ...ASSET, id: "FA-2", assetStatus: "disposed" };
  const { inServiceDate: _omit, ...noDateBase } = ASSET;
  const noDate: RunAsset = { ...noDateBase, id: "FA-3" };
  const plan = planDepreciationRun([disposed, noDate], ACCOUNTS, "2024-04-30");
  assert.equal(plan.posts.length, 0);
  assert.match(plan.skipped.find((s) => s.assetId === "FA-2")!.reason, /not in service/);
  assert.match(plan.skipped.find((s) => s.assetId === "FA-3")!.reason, /no in-service date/);
});

test("uses the org default method when the asset doesn't specify one", () => {
  const { depreciationMethod: _m, ...noMethodBase } = ASSET;
  const noMethod: RunAsset = { ...noMethodBase };
  const dbDefault: AccountingConfig = { ...ACCOUNTS, defaultDepreciationMethod: "declining_balance", decliningBalanceFactor: 2 };
  const plan = planDepreciationRun([noMethod], dbDefault, "2024-02-29");
  // First DB period on 12000 at 2/12 = 2000 (vs 1000 straight-line) — proves the default method + factor applied.
  assert.equal(plan.posts.length, 1);
  assert.equal(plan.posts[0]!.amount, 2000);
});
