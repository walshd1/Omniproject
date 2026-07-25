import test from "node:test";
import assert from "node:assert/strict";
import {
  depreciationSchedule,
  depreciationJournal,
  disposalJournal,
  type DepreciableAsset,
} from "@workspace/backend-catalogue";
import { BUSINESS_RULES, type RuleContext } from "./ruleset";

/**
 * Cross-package wiring proof: the depreciation engine's journals (catalogue) drop straight into the gateway's
 * `create_journal_entry` write path. The `finance-journal-balanced` business rule reads `payload.lines[].debit/
 * credit` — the exact shape {@link depreciationJournal}/{@link disposalJournal} emit — so a well-formed
 * depreciation posting must NEVER trip the balance rule, and a corrupted one must.
 */

const balanceRule = BUSINESS_RULES.find((r) => r.id === "finance-journal-balanced")!;

/** The rule's predicate over a would-be journal write. `true` ⇒ the rule fires (unbalanced). */
function firesOn(payload: Record<string, unknown>): boolean {
  const ctx: RuleContext = { action: "create_journal_entry", write: true, role: "admin", payload };
  return balanceRule.applies(ctx);
}

const ASSET: DepreciableAsset = { acquisitionCost: 25000, salvageValue: 1000, usefulLifeMonths: 36, depreciationMethod: "declining_balance", inServiceDate: "2024-01-01" };
const ACCOUNTS = { expenseAccount: "6800", accumulatedAccount: "1590" };

test("every period's depreciation journal balances under finance-journal-balanced", () => {
  const schedule = depreciationSchedule(ASSET);
  let posted = 0;
  for (const period of schedule) {
    const j = depreciationJournal(period, ACCOUNTS);
    if (!j) continue; // zero-amount period posts nothing
    posted++;
    assert.equal(firesOn(j as unknown as Record<string, unknown>), false, `period ${period.index} journal must balance`);
  }
  assert.ok(posted > 0, "at least one period should post");
});

test("disposal journals (gain, loss, write-off) balance under finance-journal-balanced", () => {
  const accounts = { assetAccount: "1500", accumulatedAccount: "1590", proceedsAccount: "1010", gainLossAccount: "7400" };
  const gain = disposalJournal({ acquisitionCost: 25000, accumulatedDepreciation: 18000, disposalProceeds: 9000, disposalDate: "2026-01-01" }, accounts);
  const loss = disposalJournal({ acquisitionCost: 25000, accumulatedDepreciation: 18000, disposalProceeds: 3000, disposalDate: "2026-01-01" }, accounts);
  const scrap = disposalJournal({ acquisitionCost: 25000, accumulatedDepreciation: 25000, disposalProceeds: 0, disposalDate: "2026-01-01" }, accounts);
  for (const [name, j] of [["gain", gain], ["loss", loss], ["scrap", scrap]] as const) {
    assert.equal(firesOn(j as unknown as Record<string, unknown>), false, `${name} disposal must balance`);
  }
});

test("negative control: a corrupted (unbalanced) journal DOES trip the rule", () => {
  const schedule = depreciationSchedule(ASSET);
  const j = depreciationJournal(schedule[0]!, ACCOUNTS)!;
  j.lines[1]!.credit = j.lines[1]!.credit + 0.01; // knock it out of balance by a cent
  assert.equal(firesOn(j as unknown as Record<string, unknown>), true, "an unbalanced journal must fire the rule");
});
